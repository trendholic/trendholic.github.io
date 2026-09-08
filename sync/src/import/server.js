import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ImportStore, runImport, publish, catalogContext } from './pipeline.js';
import { providers } from './providers.js';
import { requireValue, ReviewError } from './core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export function createAdmin({ repo, privateDir, token, services = providers(), port = 8788, rounding = 'retail99' }) {
  requireValue(typeof token === 'string' && token.length >= 32, 'ADMIN_TOKEN_REQUIRED');
  const store = new ImportStore(privateDir, repo);
  const lockPath = path.join(store.root, 'server.lock');
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); fs.writeFileSync(lock, String(process.pid)); }
  catch { throw new ReviewError('ADMIN_ALREADY_RUNNING_OR_STALE_LOCK'); }
  const release = () => { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); lock = undefined; } };
  for (const job of store.list()) {
    if (!['READY','PUBLISHED','FAILED','NEEDS REVIEW'].includes(job.status)) store.update(job, 'NEEDS REVIEW', { error: 'INTERRUPTED_RETRY_AVAILABLE' });
  }
  let queue = Promise.resolve(); const running = new Set();
  const enqueue = job => {
    if (running.has(job.id)) return;
    running.add(job.id);
    queue = queue.then(async () => {
      try { await runImport(store, job, services, catalogContext(repo), rounding); }
      catch { store.update(job, 'FAILED', { error: 'CATALOG_UNAVAILABLE' }); }
      finally { running.delete(job.id); }
    });
  };
  const expected = Buffer.from(`Basic ${Buffer.from(`admin:${token}`).toString('base64')}`);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return json(403, { error: 'INVALID_HOST' });
      const supplied = Buffer.from(req.headers.authorization || '');
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="TrendHolic Import", charset="UTF-8"'); return json(401, { error: 'SIGN_IN_REQUIRED' });
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${host}` || req.headers['content-type'] !== 'application/json') return json(403, { error: 'INVALID_REQUEST' });
      }
      if (req.method === 'GET' && ['/', '/admin.js', '/admin.css'].includes(req.url)) {
        const file = { '/': 'admin.html', '/admin.js': 'admin.js', '/admin.css': 'admin.css' }[req.url];
        const type = { '/': 'text/html', '/admin.js': 'text/javascript', '/admin.css': 'text/css' }[req.url];
        res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(path.join(here, file))); return;
      }
      if (req.method === 'GET' && req.url === '/api/jobs') return json(200, store.list().map(j => ({ id: j.id, status: j.status, error: j.error, product: j.product, history: j.history, imageIssues: j.imageIssues })));
      const im = /^\/api\/images\/([a-f0-9-]{36})\/(\d{1,2})$/.exec(req.url);
      if (req.method === 'GET' && im) {
        const job = store.get(im[1]); requireValue(job.product && Number(im[2]) <= job.product.images.length && Number(im[2]) > 0, 'IMAGE_NOT_FOUND');
        res.writeHead(200, { 'Content-Type': 'image/webp' }); res.end(fs.readFileSync(path.join(store.root, 'assets', job.id, `${im[2]}.webp`))); return;
      }
      if (req.method === 'POST' && req.url === '/api/import') {
        let body = ''; for await (const chunk of req) { body += chunk; requireValue(Buffer.byteLength(body) < 4096, 'INPUT_TOO_LARGE'); }
        const job = store.create(JSON.parse(body).url);
        if (job.status === 'IMPORTING') enqueue(job);
        return json(202, { id: job.id, status: job.status });
      }
      const action = /^\/api\/jobs\/([a-f0-9-]{36})\/(retry|publish)$/.exec(req.url);
      if (req.method === 'POST' && action) {
        const job = store.get(action[1]);
        if (action[2] === 'retry') {
          requireValue(['FAILED','NEEDS REVIEW'].includes(job.status) && !running.has(job.id), 'RETRY_NOT_AVAILABLE');
          store.update(job, 'IMPORTING'); enqueue(job); return json(202, { status: job.status });
        }
        requireValue(!running.size, 'IMPORT_IN_PROGRESS');
        const product = publish(store, job); return json(200, { status: 'PUBLISHED', handle: product.slug });
      }
      json(404, { error: 'NOT_FOUND' });
    } catch (e) { json(400, { error: e instanceof ReviewError ? e.code : 'REQUEST_FAILED' }); }
  });
  server.on('close', release); server.on('error', release);
  server.headersTimeout = 10000; server.requestTimeout = 15000;
  return { server, store, listen: () => server.listen(port, '127.0.0.1') };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const admin = createAdmin({ repo: path.resolve(here, '../../..'), privateDir: process.env.IMPORT_PRIVATE_DIR,
      token: process.env.IMPORT_ADMIN_TOKEN, rounding: process.env.IMPORT_ROUNDING || 'retail99' });
    admin.listen();
    console.log('Import admin: http://127.0.0.1:8788 — sign in as admin using IMPORT_ADMIN_TOKEN.');
    process.on('SIGINT', () => admin.server.close(() => process.exit(0)));
    process.on('SIGTERM', () => admin.server.close(() => process.exit(0)));
  } catch (e) { console.error(e instanceof ReviewError ? e.code : 'ADMIN_START_FAILED'); process.exitCode = 1; }
}
