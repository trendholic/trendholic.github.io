// ============================================================================
// shopify-source.js — sync a Shopify storefront via its PUBLIC /products.json
// feed (engine: "shopify"). Used for the Arabic Perfumes department
// (habibiperfumes.store). Completely separate from the tangma "album" engine —
// existing supplier adapters are untouched.
//
// Captures every real field the feed provides (never invented): name, brand
// (vendor), sku, product id, price, compare-at price, description, image
// gallery, size (ml/oz), variants, availability, category (product_type) and
// source URL (provenance only). Images are downloaded locally (never hotlinked).
// Incremental (content-hash reuse), retention-safe (never deletes on absence),
// per-source state, safe-abort on failure.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import { slugify, sha1 } from "./util.js";

let sharpLib = null;
async function sharp() { if (sharpLib === false) return null; if (sharpLib) return sharpLib;
  try { sharpLib = (await import("sharp")).default; } catch { sharpLib = false; } return sharpLib || null; }

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2)); };
const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": CONFIG.source.userAgent, accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { last = e; await sleep(1000 * (i + 1)); }
  }
  throw last;
}
async function fetchImage(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": CONFIG.source.userAgent } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") || "";
      return { buffer: Buffer.from(await res.arrayBuffer()), contentType: ct };
    } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw last;
}

// Size tokens like "100 ml" / "3.4 oz" from tags (real data only).
const extractSize = (tags) => {
  const s = (tags || []).filter((t) => /^\s*[\d.]+\s*(ml|oz)\s*$/i.test(t));
  return s.length ? [...new Set(s)].join(" / ") : null;
};

export async function syncShopifySource(src) {
  const base = src.baseUrl.replace(/\/$/, "");
  const host = new URL(base).host;
  const topSlug = src.slug || slugify(src.top);
  const stateFile = path.join(path.dirname(CONFIG.out.stateFile), `${src.key}.json`);
  const prevState = readJson(stateFile, { products: {}, updatedAt: null });
  const rep = {
    source: src.key, top: src.top, host, status: "ok",
    categories: 0, categoriesCrawled: 0, listingPagesVisited: 0, categoriesTruncated: 0, productsCategorized: 0,
    pagesFetched: 0, imageRecords: 0, physicalProducts: 0, collapsed: 0,
    new: 0, updated: 0, unchanged: 0, inactive: 0,
    imagesDiscovered: 0, imagesDownloaded: 0, imagesReused: 0, imageFailures: 0, invalidImages: 0,
    translations: 0, translationFailures: 0, failures: [],
  };

  // ---- fetch all products via public /products.json (250/page) ----
  const products = [];
  try {
    for (let page = 1; page <= 40; page++) {
      const j = await fetchJson(`${base}/products.json?limit=250&page=${page}`);
      const batch = j.products || [];
      rep.pagesFetched++;
      products.push(...batch);
      if (batch.length < 250) break;
      await sleep(CONFIG.crawl.minDelayMs);
    }
  } catch (e) {
    rep.status = "FAILED"; rep.reason = `products.json fetch: ${e.message}`;
    return rep; // safe-abort: last-known-good preserved, nothing overwritten
  }
  // optional bound for controlled test runs (0 = all)
  const MAX = parseInt(process.env.SHOPIFY_MAX_PRODUCTS || "0", 10);
  if (MAX > 0 && products.length > MAX) products.length = MAX;
  rep.imageRecords = products.length;

  // zero-products safety: never wipe an existing snapshot
  if (products.length === 0 && Object.keys(prevState.products).length > 0) {
    rep.status = "FAILED"; rep.reason = "0 products but prior snapshot exists → preserved last-known-good";
    return rep;
  }

  const imgDir = path.join(CONFIG.out.dataDir, topSlug, "images");
  const prodDir = path.join(CONFIG.out.dataDir, topSlug, "products");
  fs.mkdirSync(imgDir, { recursive: true }); fs.mkdirSync(prodDir, { recursive: true });
  const imageHashIndex = readJson(path.join(imgDir, "_hash-index.json"), {}); // hash → filename
  const nextState = { products: {}, updatedAt: new Date().toISOString() };
  const usedSlugs = new Set();

  for (const p of products) {
    try {
      const id = String(p.id);
      let slug = slugify(p.handle || p.title, 80) || `perfume-${id}`;
      if (usedSlugs.has(slug)) slug = `${slug}-${id}`;
      usedSlugs.add(slug);

      const v0 = (p.variants || [])[0] || {};
      const imgSrcs = (p.images || []).map((im) => im.src).filter(Boolean);
      const rawHash = sha1(JSON.stringify({
        t: p.title, v: p.vendor, price: v0.price, cmp: v0.compare_at_price, sku: v0.sku,
        avail: v0.available, body: p.body_html, imgs: imgSrcs, upd: p.updated_at,
      }));
      const prev = prevState.products[id];

      // reuse images if unchanged
      let images = null;
      if (prev && prev.rawHash === rawHash) {
        const existing = readJson(path.join(prodDir, `${prev.slug}.json`), null);
        if (existing?.images?.length) { images = existing.images; slug = prev.slug; usedSlugs.add(slug); rep.unchanged++; }
      }
      if (!images) {
        images = [];
        for (const srcUrl of imgSrcs.slice(0, CONFIG.images.maxPerProduct)) {
          rep.imagesDiscovered++;
          try {
            const { buffer, contentType } = await fetchImage(srcUrl);
            if (!/^(\xFF\xD8|\x89PNG|GIF8|RIFF)/.test(buffer.subarray(0, 4).toString("latin1")) && !/image\//i.test(contentType)) { rep.invalidImages++; continue; }
            const hash = sha1(buffer);
            let fname = imageHashIndex[hash];
            if (fname && fs.existsSync(path.join(imgDir, fname))) { rep.imagesReused++; }
            else {
              const s = await sharp();
              if (s) { fname = `${slug}-${images.length + 1}.webp`;
                await s(buffer).rotate().resize({ width: CONFIG.images.maxWidth, withoutEnlargement: true }).webp({ quality: CONFIG.images.webpQuality }).toFile(path.join(imgDir, fname)); }
              else { const ext = (srcUrl.split(".").pop() || "jpg").split(/[?#]/)[0].slice(0, 4).toLowerCase(); fname = `${slug}-${images.length + 1}.${ext}`; fs.writeFileSync(path.join(imgDir, fname), buffer); }
              imageHashIndex[hash] = fname; rep.imagesDownloaded++;
            }
            images.push({ src: `/data/${topSlug}/images/${fname}`, source_url: srcUrl, content_hash: hash, alt: p.title });
          } catch (e) { rep.imageFailures++; rep.failures.push(`image ${srcUrl}: ${e.message}`); }
        }
        rep[prev ? "updated" : "new"]++;
      }

      // real category from product_type → enables a real subcategory
      const cat = (p.product_type || "").trim();
      const productCategories = cat ? [{ name: cat, slug: slugify(cat), source_path: cat, parent_path: null }] : [];
      if (productCategories.length) rep.productsCategorized++;

      const variants = (p.variants || []).map((v) => ({
        title: v.title || null, price: v.price ?? null, compare_at_price: v.compare_at_price ?? null,
        sku: v.sku || null, available: !!v.available,
      }));

      const record = {
        slug, top_category: src.top,
        source_site: src.key, source_domain: host,
        source_top_category: src.top,
        source_category: cat || null, source_category_original: cat || null,
        source_categories: productCategories, source_category_slugs: productCategories.map((c) => c.slug),
        source_product_id: id, source_parent_product_id: id,
        source_product_url: `${base}/products/${p.handle}`,
        source_canonical_url: `${CONFIG.out.siteBaseUrl}${CONFIG.out.catalogPublicPath}product/${slug}/`,
        source_product_urls: [`${base}/products/${p.handle}`],
        source_image_urls: imgSrcs, source_last_seen: nextState.updatedAt,
        name: p.title, english_product_name: p.title, original_product_name: null,
        brand: (p.vendor || "").trim() || null,
        sku: v0.sku || null, model_number: null, product_code: null,
        product_id: id, parent_product_id: id,
        description: stripHtml(p.body_html) || null,
        features: [], specifications: null, materials: null,
        color: null, size: extractSize(p.tags), variants,
        dimensions: null, weight: null, packaging: null, moq: null,
        price: v0.price ?? null, compare_at_price: v0.compare_at_price ?? null,
        currency: "USD", availability: v0.available ? "In stock" : "Out of stock",
        images, pdfs: [], synced_at: nextState.updatedAt,
      };
      writeJson(path.join(prodDir, `${slug}.json`), record);
      nextState.products[id] = { rawHash, slug, firstSeen: prev?.firstSeen || nextState.updatedAt, lastSeen: nextState.updatedAt };
    } catch (e) { rep.failures.push(`product ${p.id}: ${e.message}`); }
  }

  rep.physicalProducts = Object.keys(nextState.products).length;

  // ---- retention: never delete products that disappear from the feed ----
  for (const [id, meta] of Object.entries(prevState.products)) if (!nextState.products[id]) nextState.products[id] = meta;

  writeJson(path.join(imgDir, "_hash-index.json"), imageHashIndex);
  writeJson(stateFile, nextState);
  writeJson(path.join(CONFIG.out.dataDir, topSlug, "_source-report.json"), rep);
  return rep;
}
