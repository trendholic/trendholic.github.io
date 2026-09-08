import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import sharp from 'sharp';
import { sourceUrl, pricing, categoryFor, normalizeSource, uniqueHandle, validateCopy, assertPublic } from './core.js';
import { ImportStore, atomicJson, runImport, publish, catalogContext } from './pipeline.js';
import { providers, publicAddress, processImages } from './providers.js';
import { createAdmin } from './server.js';

const tempRoots = [];
test.after(() => tempRoots.forEach(p => fs.rmSync(p, { recursive: true, force: true })));
const picture = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#bbaa88' } }).png().toBuffer();
const original = { offerId: '123456789012', currency: 'CNY', title: '不锈钢厨房台面收纳架', description: '厨房收纳', costCny: '50', priceBasis: 'single-unit', images: ['https://cbu01.alicdn.com/example.jpg'], supplierName: 'Example Source Company', variants: [], specifications: { '材料': '不锈钢' }, features: [], packageContents: [] };
const translated = { title: 'Stainless Steel Countertop Organizer', description: 'A stainless steel organizer for kitchen countertops.', features: [], specifications: { Material: 'Stainless steel' }, packageContents: [], variants: [], tags: ['kitchen', 'organizer'], confident: true, uncertainties: [], category: { name: 'Kitchen Organization', confident: true, distinct: true, reason: 'A countertop organizer for kitchen storage.' } };
function services(overrides = {}) { return { acquire: async () => structuredClone(original), translate: async () => structuredClone(translated), verify: async () => ({ valid: true, issues: [] }), exchangeRate: async () => ({ rate: '0.14', date: new Date().toISOString(), source: 'test fixture only' }), download: async () => picture, inspect: async () => ({ safe: true, chinese: false, issues: [] }), ...overrides }; }
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trendholic-test-')); tempRoots.push(root);
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  atomicJson(path.join(repo, 'data/catalog/_index.json'), { topCategories: [{ name: 'Apparel', slug: 'apparel' }] });
  atomicJson(path.join(repo, 'data/search-index.json'), { records: [] });
  return { root, repo, store: new ImportStore(path.join(root, 'private'), repo) };
}
async function imported(overrides = {}) { const s = setup(); const job = s.store.create('detail.1688.com/offer/123456789012.html'); await runImport(s.store, job, services(overrides), catalogContext(s.repo), 'exact'); return { ...s, job }; }

test('J: URLs normalize supported desktop/mobile links and reject SSRF inputs', () => {
  assert.equal(sourceUrl('http://m.1688.com/offer/123456789012.html?x=1').url, 'https://detail.1688.com/offer/123456789012.html');
  for (const url of ['https://detail.1688.com.evil.test/offer/123456789012.html', 'https://evil@detail.1688.com/offer/123456789012.html', 'https://127.0.0.1/', 'file:///a', 'https://detail.1688.com:444/offer/123456789012.html', 'https://detail.1688.com/offer/a.html']) assert.throws(() => sourceUrl(url));
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('8.8.8.8'), true);
});
test('pricing: exact 100% markup and documented ceiling-to-.99 rounding', () => {
  assert.equal(pricing('5', '1', 'exact').finalPrice, 10);
  assert.equal(pricing('12.50', '1', 'exact').finalPrice, 25);
  assert.equal(pricing('50', '0.14', 'exact').finalPrice, 14);
  assert.equal(pricing('6.86', '1').finalPrice, 13.99);
  assert.equal(pricing('12.09', '1').finalPrice, 24.99);
  assert.equal(pricing('7', '1').finalPrice, 14.99);
  assert.equal(pricing('6.995', '1').finalPrice, 13.99);
  assert.equal(pricing('6.9951', '1').finalPrice, 14.99);
  for (const x of ['0','-1','NaN','Infinity','10-20',null,'']) assert.throws(() => pricing(x, '0.14'));
});
test('F: missing, ranged, tiered, and mismatched source data fail closed', () => {
  for (const changes of [{costCny:null},{priceRange:[10,20]},{priceTiers:[]},{offerId:'999999999999'},{images:[]},{title:''}]) assert.throws(() => normalizeSource({...original,...changes}, sourceUrl('detail.1688.com/offer/123456789012.html')));
});
test('H/I: normalized taxonomy matching and justified category creation', () => {
  assert.deepEqual(categoryFor({...translated.category, name:'Kitchen Storage'}, [{name:'Kitchen Organization',slug:'kitchen-organization'}]), {name:'Kitchen Organization',slug:'kitchen-organization'});
  assert.equal(categoryFor(translated.category, []).slug,'kitchen-organization');
  assert.throws(() => categoryFor({...translated.category, distinct:false}, []));
  assert.equal(uniqueHandle('Kitchen Organizer',new Set(['kitchen-organizer'])),'kitchen-organizer-2');
});
test('A/B: Chinese source produces short validated retail copy; long source title is not copied', async () => {
  const { job } = await imported({ acquire: async () => ({...original,title: '2026新款厨房收纳架'.repeat(60)}) });
  assert.equal(job.status,'READY'); assert.equal(job.product.price,14); assert.equal(job.product.name,translated.title);
  assert.ok(!JSON.stringify(job.product).includes(original.supplierName));
});
test('C: variant identity, order and prices retained without supplier SKU', async () => {
  const variants = [{id:'internal-red',costCny:'50',options:[{name:'颜色',value:'红色'}]},{id:'internal-blue',costCny:'60',options:[{name:'颜色',value:'蓝色'}]}];
  const copy = {...translated,variants:variants.map((v,i)=>({sourceId:v.id,options:[{name:'Color',value:i?'Blue':'Red'}]}))};
  const {job} = await imported({acquire:async()=>({...original,variants}),translate:async()=>copy});
  assert.equal(job.status,'READY'); assert.deepEqual(job.product.variants.map(v=>v.price),[14,16.8]);
  assert.ok(!JSON.stringify(job.product).includes('internal-red'));
  assert.throws(()=>validateCopy({...copy,variants:copy.variants.slice().reverse()}, {...original,variants}, []));
});
test('D: English image edit requires fresh inspection and visual equivalence check', async () => {
  let inspections=0;
  const result=await imported({inspect:async()=>++inspections===1?{safe:false,chinese:true,essentialText:true,text:'厨房',translation:'Kitchen',issues:['Chinese text']}:{safe:true,chinese:false,issues:[]},edit:async()=>picture,compare:async()=>({valid:true,issues:[]})});
  assert.equal(result.job.status,'READY'); assert.equal(inspections,2);
  const bad=await imported({inspect:async()=>({safe:false,chinese:true,essentialText:true,issues:['Chinese text']}),edit:async()=>picture,compare:async()=>({valid:false,issues:['Product changed']})});
  assert.equal(bad.job.status,'NEEDS REVIEW');
});
test('E: supplier/contact copy and branded images are never exported', async () => {
  for (const title of ['Example Source Company Organizer','Call 123-456-7890','1688 Organizer','厨房 Organizer']) {
    const {job}=await imported({translate:async()=>({...translated,title})}); assert.equal(job.status,'NEEDS REVIEW');
  }
  const {job}=await imported({inspect:async()=>({safe:false,chinese:false,issues:['QR code and supplier branding']})});
  assert.equal(job.status,'NEEDS REVIEW'); assert.equal(job.product,undefined);
});
test('G: repeated URL and existing product title do not create duplicates', async () => {
  const {store,job,repo}=await imported(); assert.equal(store.create(job.source.url+'?tracking=1').id,job.id);
  publish(store,job); assert.equal(job.status,'PUBLISHED'); assert.throws(()=>publish(store,job));
  const other=store.create('detail.1688.com/offer/999999999999.html');
  await runImport(store,other,services({acquire:async()=>({...original,offerId:'999999999999'})}),catalogContext(repo));
  assert.equal(other.status,'NEEDS REVIEW'); assert.equal(other.error,'DUPLICATE_PRODUCT');
});
test('K/L: corrupt images, missing price, ambiguity, provider failures remain private', async () => {
  for(const overrides of [{download:async()=>Buffer.from('bad')},{acquire:async()=>({...original,costCny:''})},{translate:async()=>({...translated,uncertainties:['Unusual material term']})},{verify:async()=>({valid:false,issues:['Unsupported measurement']})},{acquire:async()=>{throw Error('secret provider response')}}]) {
    const {job,repo}=await imported(overrides); assert.ok(['FAILED','NEEDS REVIEW'].includes(job.status));
    assert.equal(fs.existsSync(path.join(repo,'data/imported/products.json')),false); assert.notEqual(job.error,'secret provider response');
  }
});
test('public projection rejects extra provenance, image URLs, and variant fields', async () => {
  const {job}=await imported();
  assert.throws(()=>assertPublic({...job.product,sourceUrl:original.offerId}));
  const unsafe=structuredClone(job.product); unsafe.images[0].url='https://cbu01.alicdn.com/test.jpg'; assert.throws(()=>assertPublic(unsafe));
  const isolated = setup(); assert.throws(()=>new ImportStore(path.join(isolated.repo,'private'),isolated.repo));
});
test('FX requires an explicit current quote and source, and never silently defaults', async () => {
  await assert.rejects(()=>providers({}).exchangeRate());
  await assert.rejects(()=>providers({IMPORT_FX_USD_PER_CNY:'0.14',IMPORT_FX_SOURCE:'test',IMPORT_FX_DATE:'2020-01-01'}).exchangeRate());
});
test('image processing decodes, strips metadata and deduplicates', async () => {
  const {images}=await processImages({...original,images:[original.images[0],original.images[0]+'?v=2']},services(),async(_k,f)=>f());
  assert.equal(images.length,1); const metadata=await sharp(images[0].bytes).metadata(); assert.equal(metadata.format,'webp'); assert.equal(metadata.exif,undefined);
});
test('admin rejects unauthenticated, cross-origin and unexpected Host requests', async () => {
  const {repo,root}=setup(); const token='test-only-admin-token-'.repeat(3);
  const app=createAdmin({repo,privateDir:path.join(root,'admin'),token,services:services(),port:0});
  app.listen(); await new Promise(r=>app.server.once('listening',r)); const base=`http://127.0.0.1:${app.server.address().port}`;
  const authorization=`Basic ${Buffer.from('admin:'+token).toString('base64')}`;
  try {
    assert.equal((await fetch(base)).status,401);
    assert.equal((await fetch(base,{headers:{authorization}})).status,200);
    assert.equal((await fetch(base+'/api/import',{method:'POST',headers:{authorization,'content-type':'application/json',origin:'https://evil.test'},body:'{}'})).status,403);
    const badHostStatus = await new Promise((resolve,reject) => http.get(base,{headers:{authorization,host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
    assert.equal(badHostStatus,403);
  } finally { await new Promise(r=>app.server.close(r)); }
});
test('existing generator merges imports additively, renders variants, search and SEO', async () => {
  const {repo,job,store}=await imported(); publish(store,job);
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  fs.mkdirSync(path.join(repo,'sync/src/import'),{recursive:true});
  for (const relative of ['config.js','src/util.js','src/build-catalog.js','src/import/core.js','src/import/catalog.js']) fs.copyFileSync(path.join(source,relative),path.join(repo,'sync',relative));
  atomicJson(path.join(repo,'sync/package.json'),{type:'module'});
  const existing={slug:'existing-shirt',name:'Existing Shirt',top_category:'Apparel',images:[],description:'Existing description'};
  atomicJson(path.join(repo,'data/apparel/products/existing-shirt.json'),existing);
  const before=fs.readFileSync(path.join(repo,'data/apparel/products/existing-shirt.json'));
  execFileSync(process.execPath,[path.join(repo,'sync/src/build-catalog.js')]);
  assert.deepEqual(fs.readFileSync(path.join(repo,'data/apparel/products/existing-shirt.json')),before);
  const records=JSON.parse(fs.readFileSync(path.join(repo,'data/search-index.json'))).records;
  assert.equal(records.length,2); assert.ok(records.some(p=>p.slug==='existing-shirt')); assert.ok(records.some(p=>p.slug===job.product.slug));
  const page=fs.readFileSync(path.join(repo,'catalog/product',job.product.slug,'index.html'),'utf8');
  assert.ok(page.includes('Stainless Steel Countertop Organizer')); assert.ok(!page.includes('1688')); assert.ok(!page.includes('InStock'));
  assert.ok(fs.existsSync(path.join(repo,'catalog/kitchen-organization/index.html')));
});

test('desktop/mobile browser: admin, variants, cart and no horizontal overflow', {skip:!process.env.IMPORT_TEST_BROWSER}, async () => {
  const { chromium } = await import('playwright-core');
  const v={id:'private-red',costCny:'50',options:[{name:'颜色',value:'红色'}]};
  const {repo,root,store,job}=await imported({acquire:async()=>({...original,variants:[v]}),translate:async()=>({...translated,variants:[{sourceId:v.id,options:[{name:'Color',value:'Red'}]}]})});
  publish(store,job);
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  fs.mkdirSync(path.join(repo,'sync/src/import'),{recursive:true});
  for(const relative of ['config.js','src/util.js','src/build-catalog.js','src/import/core.js','src/import/catalog.js']) fs.copyFileSync(path.join(source,relative),path.join(repo,'sync',relative));
  atomicJson(path.join(repo,'sync/package.json'),{type:'module'});
  execFileSync(process.execPath,[path.join(repo,'sync/src/build-catalog.js')]);
  const staticServer=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const file=path.join(repo,url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
    if(!file.startsWith(repo+path.sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
  const token='browser-test-password-'.repeat(3), admin=createAdmin({repo,privateDir:path.join(root,'browser-admin'),token,port:0});admin.listen();await new Promise(r=>admin.server.once('listening',r));
  const browser=await chromium.launch({executablePath:process.env.IMPORT_TEST_BROWSER,headless:true});
  try {
    for(const width of [1280,375]) {
      const context=await browser.newContext({viewport:{width,height:900},httpCredentials:{username:'admin',password:token}}),page=await context.newPage();
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      const base=`http://127.0.0.1:${staticServer.address().port}`;
      await page.goto(`${base}/catalog/product/${job.product.slug}/`);
      assert.equal(await page.locator('.import-variant').count(),1);
      await page.click('.add-cart');
      assert.equal(await page.locator('#cart-count').textContent(),'1');
      assert.ok((await page.locator('.cart-row').textContent()).includes('Red'));
      assert.ok((await page.locator('.cart-row').textContent()).includes('14'));
      await page.reload(); assert.equal(await page.locator('#cart-count').textContent(),'1');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.goto(`http://127.0.0.1:${admin.server.address().port}/`);
      await page.fill('#url','https://example.com/invalid');await page.click('form button');
      await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('valid 1688'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);await context.close();
    }
  } finally {await browser.close();await new Promise(r=>staticServer.close(r));await new Promise(r=>admin.server.close(r));}
});
