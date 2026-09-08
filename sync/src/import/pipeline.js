import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sourceUrl, normalizeSource, validateCopy, pricing, categoryFor, uniqueHandle, publicProduct, assertPublic, hash, requireValue, ReviewError } from './core.js';
import { processImages } from './providers.js';

export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw new ReviewError('STORAGE_CORRUPT'); }
}
export class ImportStore {
  constructor(directory, repo) {
    requireValue(directory && path.isAbsolute(directory), 'PRIVATE_DIRECTORY_REQUIRED');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.root = fs.realpathSync(directory); this.repo = fs.realpathSync(repo);
    const relative = path.relative(this.repo, this.root);
    requireValue(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'PRIVATE_DIRECTORY_IN_REPOSITORY');
    this.file = path.join(this.root, 'imports.json');
    this.state = readJson(this.file, { jobs: {} });
  }
  save() { atomicJson(this.file, this.state); }
  list() { return Object.values(this.state.jobs); }
  get(id) { requireValue(this.state.jobs[id], 'JOB_NOT_FOUND'); return this.state.jobs[id]; }
  update(job, status, extra = {}) {
    Object.assign(job, extra, { status, updatedAt: new Date().toISOString() });
    job.history.push({ status, at: job.updatedAt }); this.save();
  }
  create(url) {
    const identity = sourceUrl(url);
    const duplicate = this.list().find(j => j.source.id === identity.id);
    if (duplicate) return duplicate;
    const job = { id: crypto.randomUUID(), source: identity, status: 'IMPORTING', history: [], createdAt: new Date().toISOString() };
    this.state.jobs[job.id] = job; this.update(job, 'IMPORTING'); return job;
  }
  async cache(key, fn, binary = false) {
    const file = path.join(this.root, 'cache', hash(key));
    if (fs.existsSync(file)) return binary ? fs.readFileSync(file) : readJson(file);
    const result = await fn();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (binary) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, result, { mode: 0o600 }); fs.renameSync(tmp, file); }
    else atomicJson(file, result);
    return result;
  }
}
export function catalogContext(repo) {
  const index = readJson(path.join(repo, 'data/catalog/_index.json')); // never treat a missing checkout as empty
  const search = readJson(path.join(repo, 'data/search-index.json'));
  const imported = readJson(path.join(repo, 'data/imported/products.json'), { products: [] });
  requireValue(Array.isArray(index.topCategories) && Array.isArray(search.records) && Array.isArray(imported.products), 'CATALOG_REQUIRED');
  return { categories: [...index.topCategories.map(c => ({ name: c.name, slug: c.slug })), ...imported.products.map(p => ({ name: p.top_category, slug: p.category_slug }))],
    products: [...search.records, ...imported.products] };
}
export async function runImport(store, job, services, context, mode = 'retail99') {
  try {
    requireValue(job.status !== 'PUBLISHED', 'ALREADY_PUBLISHED');
    store.update(job, 'IMPORTING', { error: null });
    const raw = await services.acquire(job.source);
    store.update(job, 'PROCESSING');
    const source = normalizeSource(raw, job.source); job.extraction = source; store.save();
    const deny = [job.source.id, source.supplierName, ...source.supplierIdentifiers, ...source.variants.map(v => v.id)];
    store.update(job, 'TRANSLATING');
    const cache = store.cache.bind(store);
    const translated = await cache(`copy-v1:${hash(JSON.stringify({ source, categories: context.categories }))}`, () => services.translate(source, context.categories));
    const copy = validateCopy(translated, source, deny);
    const verification = await cache(`verify-v1:${hash(JSON.stringify({ source, translated }))}`, () => services.verify(source, translated));
    requireValue(verification.valid === true && Array.isArray(verification.issues) && verification.issues.length === 0, 'TRANSLATION_REVIEW');
    store.update(job, 'CATEGORIZING');
    const category = categoryFor(translated.category, context.categories);
    store.update(job, 'PRICING');
    const fx = await services.exchangeRate();
    const prices = [pricing(source.costCny, fx.rate, mode), ...source.variants.map(v => pricing(v.costCny, fx.rate, mode))];
    // A single displayed price must represent the cheapest actually selectable option.
    if (copy.variants.length) prices[0] = prices.slice(1).reduce((a,b) => a.finalPrice < b.finalPrice ? a : b);
    job.pricing = { fx, prices }; store.save();
    store.update(job, 'PROCESSING IMAGES');
    const { images, issues } = await processImages(source, services, cache);
    job.imageIssues = issues;
    // Missing useful text or a failed edit could omit essential product information.
    requireValue(!issues.some(i => i !== 'IMAGE_EXCLUDED' && i !== 'IMAGE_UNAVAILABLE'), 'IMAGE_REVIEW');
    store.update(job, 'VALIDATING');
    const normalizedTitle = slugifyTitle(copy.title);
    requireValue(!context.products.some(p => slugifyTitle(p.name) === normalizedTitle), 'DUPLICATE_PRODUCT');
    requireValue(!store.list().some(j => j.id !== job.id && ['READY','PUBLISHED'].includes(j.status) && (slugifyTitle(j.product?.name) === normalizedTitle || j.imageHashes?.some(h => images.some(i => i.hash === h)))), 'DUPLICATE_PRODUCT');
    const handle = uniqueHandle(copy.title, new Set(context.products.map(p => p.slug)));
    const product = publicProduct(copy, category, prices, images, handle, job.id);
    assertPublic(product);
    const assets = path.join(store.root, 'assets', job.id); fs.mkdirSync(assets, { recursive: true, mode: 0o700 });
    images.forEach((im, i) => fs.writeFileSync(path.join(assets, `${i + 1}.webp`), im.bytes, { mode: 0o600 }));
    store.update(job, 'READY', { product, imageHashes: images.map(i => i.hash), translationStatus: 'VALIDATED' });
  } catch (e) {
    store.update(job, e instanceof ReviewError ? 'NEEDS REVIEW' : 'FAILED', { error: e instanceof ReviewError ? e.code : 'IMPORT_FAILED' });
  }
  return job;
}
const slugifyTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function publish(store, job) {
  requireValue(job.status === 'READY', 'NOT_READY');
  requireValue(Date.now() - Date.parse(job.updatedAt) < 7 * 86400000, 'STALE_REVIEW_REIMPORT_REQUIRED');
  requireValue(Date.now() - Date.parse(job.pricing?.fx?.date) < 7 * 86400000, 'EXCHANGE_RATE_REQUIRED');
  assertPublic(job.product);
  const context = catalogContext(store.repo), p = job.product;
  requireValue(!context.products.some(other => other.slug === p.slug || slugifyTitle(other.name) === slugifyTitle(p.name)), 'DUPLICATE_PRODUCT');
  const manifestFile = path.join(store.repo, 'data/imported/products.json');
  const manifest = readJson(manifestFile, { products: [] });
  const existing = context.categories.find(c => c.slug === p.category_slug);
  requireValue(!existing || existing.name === p.top_category, 'CATEGORY_COLLISION');
  // Stage assets first, manifest last. Readers never see a half-written product.
  for (let i = 0; i < p.images.length; i++) {
    const destination = path.join(store.repo, p.images[i].src.slice(1));
    const bytes = fs.readFileSync(path.join(store.root, 'assets', job.id, `${i + 1}.webp`));
    requireValue(hash(bytes) === job.imageHashes[i], 'IMAGE_CHANGED');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) requireValue(hash(fs.readFileSync(destination)) === hash(bytes), 'IMAGE_COLLISION');
    else fs.writeFileSync(destination, bytes, { flag: 'wx' });
  }
  atomicJson(manifestFile, { products: [...manifest.products, p] });
  store.update(job, 'PUBLISHED');
  return p;
}
