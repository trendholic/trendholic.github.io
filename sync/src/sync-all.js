// ============================================================================
// sync-all.js — full multi-source synchronization orchestrator.
// For each of the 4 verified sources, independently:
//   robots preflight → category discovery → product discovery (image-level
//   pages) → GROUP into physical products (grouping.js) → download images
//   locally (content-hash dedupe) → write canonical product JSON w/ provenance
//   → update per-source state (.state/<key>.json) → per-source report.
// Safety: a source failure is isolated (last-known-good preserved, products NOT
// marked removed); a zero-products result never overwrites a good snapshot.
//
// SCALE: the complete crawl (all categories, all products) is intended to run
// on the nightly GitHub Actions runner. Bound an in-session run with:
//   MAX_PAGES_PER_SOURCE (image-level product pages to fetch per source, 0=all)
//   SYNC_SOURCES=apparel,bags     (subset of sources)
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import CONFIG from "../config.js";
import { fetchHtml, fetchBuffer, robotsAllows, robotsStatus, limiter } from "./http.js";
import { getAdapter } from "./adapters/index.js";
import { groupProductPages } from "./grouping.js";
import { slugify, sha1 } from "./util.js";

let sharpLib = null;
async function sharp() { if (sharpLib === false) return null; if (sharpLib) return sharpLib;
  try { sharpLib = (await import("sharp")).default; } catch { sharpLib = false; } return sharpLib || null; }

const MAX_PAGES = parseInt(process.env.MAX_PAGES_PER_SOURCE || "0", 10); // 0 = no image-page cap (test bound)
const MAX_PAGES_PER_CAT = parseInt(process.env.MAX_PAGES_PER_CATEGORY || "0", 10); // 0 = paginate to natural end
const MAX_CATS = parseInt(process.env.MAX_CATEGORIES_PER_SOURCE || "0", 10); // 0 = all discovered categories
const PAGE_SAFETY_CEIL = parseInt(process.env.CATEGORY_PAGE_CEILING || "3000", 10); // per-listing infinite-loop backstop
// The supplier's category pages do not expose products over HTTP (verified), so
// category crawling is OFF by default — the New Products feed is the product
// source. Enable only if a future rendered/authenticated crawl can list them.
const CRAWL_CATEGORIES = ["1", "true", "yes", "on"].includes(String(process.env.CRAWL_CATEGORIES || "").toLowerCase());
// Resumable feed window: how many feed listing pages to crawl per run (0 = to
// the natural end). Runs resume from the saved cursor and wrap at the end, so
// successive nightly runs march through the full catalog and then keep it fresh.
const FEED_WINDOW = parseInt(process.env.FEED_PAGES_PER_RUN || "0", 10);
const ONLY = (process.env.SYNC_SOURCES || "").split(",").map((s) => s.trim()).filter(Boolean);
const dataDir = CONFIG.out.dataDir;
const stateDir = path.dirname(CONFIG.out.stateFile);

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2)); };

async function syncSource(src) {
  const base = src.baseUrl.replace(/\/$/, "");
  const host = new URL(base).host;
  const { adapter } = getAdapter(base);
  const topSlug = slugify(src.top);
  const stateFile = path.join(stateDir, `${src.key}.json`);
  const prevState = readJson(stateFile, { products: {}, categories: [], updatedAt: null });
  const rep = {
    source: src.key, top: src.top, host, status: "ok",
    categories: 0, categoriesCrawled: 0, listingPagesVisited: 0, categoriesTruncated: 0,
    productsCategorized: 0, pagesFetched: 0, imageRecords: 0, physicalProducts: 0,
    collapsed: 0, new: 0, updated: 0, unchanged: 0, inactive: 0,
    imagesDiscovered: 0, imagesDownloaded: 0, imagesReused: 0, imageFailures: 0, invalidImages: 0,
    translations: 0, translationFailures: 0, failures: [],
  };

  // ---- robots / access preflight (fail closed) ----
  if (CONFIG.source.respectRobots && !(await robotsAllows(base + "/"))) {
    rep.status = "BLOCKED"; rep.reason = await robotsStatus(base + "/");
    return rep; // last-known-good preserved; nothing overwritten
  }

  // ---- category discovery ----
  let categories = [];
  try {
    const $home = cheerio.load(await fetchHtml(base + "/"));
    categories = adapter.discoverCategories($home, base).map((c) => ({
      name: c.name, slug: slugify(c.name), source_url: c.url,
      source_path: c.sourcePath || null,
      parent_path: c.sourcePath && c.sourcePath.includes("_")
        ? c.sourcePath.split("_").slice(0, -1).join("_") : null,
    }));
    rep.categories = categories.length;
    writeJson(path.join(dataDir, topSlug, "categories.json"),
      { top: src.top, source: src.key, host, count: categories.length, updatedAt: new Date().toISOString(), categories });
  } catch (e) { rep.status = "FAILED"; rep.reason = `category discovery: ${e.message}`; return rep; }

  // ---- product discovery -------------------------------------------------
  //  Primary source: the "New Products" feed, which is effectively the full
  //  catalog paginated newest-first (hundreds of pages per source). It is
  //  crawled in a RESUMABLE WINDOW: each run continues from the saved cursor
  //  and wraps at the end, so successive nightly runs march through the entire
  //  catalog and then keep it fresh — no arbitrary production cap, and deep
  //  products are never lost between runs (incremental hashing skips unchanged
  //  ones). Category crawling is OFF by default because this supplier's
  //  category pages expose no products over HTTP (see CRAWL_CATEGORIES).
  const pageUrls = new Set();
  const productToCats = new Map();   // productUrl -> Set(catKey) of real categories
  const catByKey = new Map();        // catKey -> {name, slug, source_path, parent_path}
  const reachedCap = () => MAX_PAGES > 0 && pageUrls.size >= MAX_PAGES;
  const FEED_START = base + "/newproductsen_0.html";

  // Optional: crawl discovered categories for products (only useful if a future
  // rendered/authenticated crawl can list them; a no-op on plain HTTP here).
  if (CRAWL_CATEGORIES) {
    const realCats = MAX_CATS > 0 ? categories.slice(0, MAX_CATS) : categories;
    for (const c of realCats) {
      if (reachedCap()) break;
      const catKey = c.source_path || c.slug || c.source_url;
      catByKey.set(catKey, { name: c.name, slug: c.slug, source_path: c.source_path, parent_path: c.parent_path });
      let listUrl = c.source_url, pageNo = 0; const seen = new Set();
      while (listUrl && !seen.has(listUrl)) {
        if (reachedCap()) break;
        if (MAX_PAGES_PER_CAT > 0 && pageNo >= MAX_PAGES_PER_CAT) { rep.categoriesTruncated++; break; }
        if (pageNo >= PAGE_SAFETY_CEIL) { rep.categoriesTruncated++; break; }
        seen.add(listUrl); pageNo++; rep.listingPagesVisited++;
        let $l; try { $l = cheerio.load(await fetchHtml(listUrl)); } catch (e) { rep.failures.push(`listing ${listUrl}: ${e.message}`); break; }
        const { productUrls, nextPage } = adapter.parseCategory($l, listUrl, base);
        for (const u of productUrls) {
          if (MAX_PAGES > 0 && !pageUrls.has(u) && pageUrls.size >= MAX_PAGES) continue;
          pageUrls.add(u);
          if (!productToCats.has(u)) productToCats.set(u, new Set());
          productToCats.get(u).add(catKey);
        }
        if (!nextPage || nextPage === listUrl) break;
        listUrl = nextPage;
      }
    }
    rep.categoriesCrawled = MAX_CATS > 0 ? Math.min(MAX_CATS, categories.length) : categories.length;
  }

  // Resumable New Products feed window.
  let feedResumeUrl = FEED_START;
  {
    let listUrl = prevState.feedResumeUrl || FEED_START;
    let feedPages = 0; const seen = new Set();
    while (listUrl && !seen.has(listUrl)) {
      if (reachedCap()) { feedResumeUrl = listUrl; break; }
      if (FEED_WINDOW > 0 && feedPages >= FEED_WINDOW) { feedResumeUrl = listUrl; break; }
      if (feedPages >= PAGE_SAFETY_CEIL) { feedResumeUrl = FEED_START; break; }
      seen.add(listUrl); feedPages++; rep.listingPagesVisited++;
      let $l; try { $l = cheerio.load(await fetchHtml(listUrl)); } catch (e) { rep.failures.push(`feed ${listUrl}: ${e.message}`); feedResumeUrl = listUrl; break; }
      const { productUrls, nextPage } = adapter.parseCategory($l, listUrl, base);
      for (const u of productUrls) {
        if (MAX_PAGES > 0 && !pageUrls.has(u) && pageUrls.size >= MAX_PAGES) continue;
        pageUrls.add(u);
      }
      if (!nextPage || nextPage === listUrl) { feedResumeUrl = FEED_START; break; } // reached end → wrap to refresh
      listUrl = nextPage; feedResumeUrl = listUrl;
    }
  }
  rep.feedResumeUrl = feedResumeUrl;

  // ---- fetch each image-level page (extract raw record) ----
  const run = limiter(CONFIG.crawl.concurrency);
  const pages = (await Promise.all([...pageUrls].map((url) => run(async () => {
    try {
      const $p = cheerio.load(await fetchHtml(url));
      const raw = adapter.parseProduct($p, url, base);
      raw.images = (raw.images || []).map((u) => ({ source_url: u }));
      return raw;
    } catch (e) { rep.failures.push(`page ${url}: ${e.message}`); return null; }
  })))).filter(Boolean);
  rep.pagesFetched = pages.length;
  rep.imageRecords = pages.length;

  // ---- GROUP into physical products (verified grouping.js) ----
  const grouped = groupProductPages(pages.map((p) => ({
    sourceProductId: p.sourceProductId, sourceUrl: p.sourceUrl, name: p.name, images: p.images,
  })));
  rep.physicalProducts = grouped.length;
  rep.collapsed = pages.length - grouped.length;

  // ---- zero-products safety guard ----
  if (grouped.length === 0 && Object.keys(prevState.products).length > 0) {
    rep.status = "FAILED"; rep.reason = "0 products but prior snapshot exists → preserved last-known-good";
    return rep;
  }

  // ---- per-product: images + canonical record + state diff ----
  const imgDir = path.join(dataDir, topSlug, "images");
  const prodDir = path.join(dataDir, topSlug, "products");
  fs.mkdirSync(imgDir, { recursive: true }); fs.mkdirSync(prodDir, { recursive: true });
  const nextState = { products: {}, categories: categories.map((c) => c.slug), feedResumeUrl, updatedAt: new Date().toISOString() };
  const imageHashIndex = readJson(path.join(imgDir, "_hash-index.json"), {}); // hash → filename

  for (const g of grouped) {
    try {
      const key = g.parent_product_id || sha1(g.image_base);
      const slug = (slugify(g.name, 60) + "-" + key).replace(/-+$/, "") || slugify(g.image_base);
      const rawHash = sha1(JSON.stringify({ name: g.name, images: g.images.map((i) => i.source_url), ids: g.page_ids }));
      const prev = prevState.products[key];

      let images;
      if (prev && prev.rawHash === rawHash) {
        const existing = readJson(path.join(prodDir, `${prev.slug}.json`), null);
        if (existing) { images = existing.images; rep.unchanged++; }
      }
      if (!images) {
        images = [];
        for (const im of g.images.slice(0, CONFIG.images.maxPerProduct)) {
          rep.imagesDiscovered++;
          try {
            const { buffer, contentType } = await fetchBuffer(im.source_url);
            if (!/^(\xFF\xD8|\x89PNG|GIF8|RIFF)/.test(buffer.subarray(0, 4).toString("latin1")) &&
                !/image\//i.test(contentType)) { rep.invalidImages++; continue; }
            const hash = sha1(buffer);
            let fname = imageHashIndex[hash];
            if (fname && fs.existsSync(path.join(imgDir, fname))) { rep.imagesReused++; }
            else {
              const ext = (im.source_url.split(".").pop() || "jpg").split(/[?#]/)[0].slice(0, 4).toLowerCase();
              fname = `${slug}-${images.length + 1}.${ext}`;
              const s = await sharp();
              if (s) { fname = `${slug}-${images.length + 1}.webp`;
                await s(buffer).rotate().resize({ width: CONFIG.images.maxWidth, withoutEnlargement: true })
                  .webp({ quality: CONFIG.images.webpQuality }).toFile(path.join(imgDir, fname)); }
              else fs.writeFileSync(path.join(imgDir, fname), buffer);
              imageHashIndex[hash] = fname; rep.imagesDownloaded++;
            }
            images.push({ src: `/data/${topSlug}/images/${fname}`, source_url: im.source_url, content_hash: hash, alt: g.name });
          } catch (e) { rep.imageFailures++; rep.failures.push(`image ${im.source_url}: ${e.message}`); }
        }
        rep[prev ? "updated" : "new"]++;
      }

      // real supplier categories for this physical product (union across the
      // image-level pages it groups). Products found only via the New Products
      // feed have no real category → honestly fall back to "New Products".
      const catKeys = new Set();
      for (const purl of g.source_product_urls) {
        const s = productToCats.get(purl);
        if (s) for (const k of s) catKeys.add(k);
      }
      const productCategories = [...catKeys].map((k) => catByKey.get(k)).filter(Boolean)
        .map((c) => ({ name: c.name, slug: c.slug, source_path: c.source_path, parent_path: c.parent_path || null }));
      const primaryCat = productCategories[0] || null;
      if (productCategories.length) rep.productsCategorized++;

      // canonical physical-product record (Phase 3 fields; never fabricated)
      const record = {
        slug, top_category: src.top,
        source_site: src.key, source_domain: host,
        source_top_category: src.top,
        source_category: primaryCat ? primaryCat.name : "New Products",
        source_category_original: primaryCat ? primaryCat.source_path : "new",
        source_categories: productCategories,                    // all real categories (multi-membership)
        source_category_slugs: productCategories.map((c) => c.slug),
        source_product_id: g.page_ids[0] || null, source_parent_product_id: g.parent_product_id,
        source_product_url: g.source_product_urls[0] || null,
        source_canonical_url: `${CONFIG.out.siteBaseUrl}${CONFIG.out.catalogPublicPath}product/${slug}/`,
        source_product_urls: g.source_product_urls, source_image_urls: g.images.map((i) => i.source_url),
        source_last_seen: nextState.updatedAt,
        name: g.name, english_product_name: g.name, original_product_name: null,
        brand: null, sku: null, model_number: null, product_code: null,
        product_id: g.parent_product_id, parent_product_id: g.parent_product_id,
        description: null, features: [], specifications: null, materials: null,
        color: null, size: null, variants: [], dimensions: null, weight: null,
        packaging: null, moq: null, price: null, currency: null, availability: null,
        images, pdfs: [], synced_at: nextState.updatedAt,
      };
      writeJson(path.join(prodDir, `${slug}.json`), record);
      nextState.products[key] = { rawHash, slug, parent_product_id: g.parent_product_id,
        firstSeen: prev?.firstSeen || nextState.updatedAt, lastSeen: nextState.updatedAt };
    } catch (e) { rep.failures.push(`product ${g.name}: ${e.message}`); }
  }

  // ---- inactive detection (ONLY on a verified COMPLETE single-run crawl) ----
  //  Safe only when the whole feed was traversed to its end in this run (no test
  //  cap, no window, cursor wrapped back to the start). A WINDOWED run sees only
  //  part of the catalog, so unseen products MUST be preserved, never deactivated.
  const completeCrawl = MAX_PAGES === 0 && FEED_WINDOW === 0 && feedResumeUrl === FEED_START;
  if (completeCrawl) {
    for (const [k, meta] of Object.entries(prevState.products)) {
      if (!nextState.products[k]) { nextState.products[k] = { ...meta, inactive: true, lastSeen: meta.lastSeen };
        rep.inactive++; }
    }
  } else {
    for (const [k, meta] of Object.entries(prevState.products)) if (!nextState.products[k]) nextState.products[k] = meta;
  }

  writeJson(path.join(imgDir, "_hash-index.json"), imageHashIndex);
  writeJson(stateFile, nextState);
  writeJson(path.join(dataDir, topSlug, "_source-report.json"), rep);
  return rep;
}

async function main() {
  const started = Date.now();
  const sources = CONFIG.sources.filter((s) => !ONLY.length || ONLY.includes(s.key));
  console.log(`FULL SYNC — sources: ${sources.map((s) => s.key).join(", ")} | MAX_PAGES_PER_SOURCE=${MAX_PAGES || "ALL"}`);
  const reports = [];
  for (const src of sources) {
    console.log(`\n=== ${src.top} (${src.key}) ===`);
    const r = await syncSource(src);
    reports.push(r);
    console.log(`  status=${r.status} categories=${r.categories} crawled=${r.categoriesCrawled} ` +
      `listingPages=${r.listingPagesVisited} truncated=${r.categoriesTruncated} pages=${r.pagesFetched} ` +
      `physical=${r.physicalProducts} categorized=${r.productsCategorized} collapsed=${r.collapsed} ` +
      `new=${r.new} updated=${r.updated} unchanged=${r.unchanged} inactive=${r.inactive} ` +
      `images=${r.imagesDownloaded}(+${r.imagesReused} reused) imgFail=${r.imageFailures} invalid=${r.invalidImages}`);
    if (r.status !== "ok") console.log(`  ⚠ ${r.status}: ${r.reason || ""}`);
  }
  const global = {
    finishedAt: new Date().toISOString(), durationMs: Date.now() - started, bounded: MAX_PAGES > 0, maxPagesPerSource: MAX_PAGES,
    sources: reports,
    totals: reports.reduce((t, r) => ({
      categories: t.categories + r.categories, categoriesCrawled: t.categoriesCrawled + r.categoriesCrawled,
      listingPagesVisited: t.listingPagesVisited + r.listingPagesVisited, categoriesTruncated: t.categoriesTruncated + r.categoriesTruncated,
      productsCategorized: t.productsCategorized + r.productsCategorized,
      imageRecords: t.imageRecords + r.imageRecords,
      physicalProducts: t.physicalProducts + r.physicalProducts, collapsed: t.collapsed + r.collapsed,
      new: t.new + r.new, updated: t.updated + r.updated, unchanged: t.unchanged + r.unchanged, inactive: t.inactive + r.inactive,
      imagesDownloaded: t.imagesDownloaded + r.imagesDownloaded, imagesReused: t.imagesReused + r.imagesReused,
      imageFailures: t.imageFailures + r.imageFailures, invalidImages: t.invalidImages + r.invalidImages,
      translations: t.translations + r.translations, translationFailures: t.translationFailures + r.translationFailures,
    }), { categories: 0, categoriesCrawled: 0, listingPagesVisited: 0, categoriesTruncated: 0, productsCategorized: 0, imageRecords: 0, physicalProducts: 0, collapsed: 0, new: 0, updated: 0, unchanged: 0, inactive: 0, imagesDownloaded: 0, imagesReused: 0, imageFailures: 0, invalidImages: 0, translations: 0, translationFailures: 0 }),
  };
  writeJson(path.join(dataDir, "sync-report.json"), global);
  console.log("\n=== GLOBAL TOTALS ===\n" + JSON.stringify(global.totals, null, 2));
}
main().catch((e) => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
