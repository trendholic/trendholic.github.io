// ============================================================================
// index.js — orchestrator. Crawl → translate → images → SEO → dedupe → store
//            → sitemap → search index → logs. Per-item failures never stop it.
// ============================================================================
import CONFIG from "../config.js";
import log from "./logger.js";
import { limiter, robotsAllows, robotsStatus } from "./http.js";
import { closeBrowser } from "./browser.js";
import * as crawl from "./crawl.js";
import { translateProduct, persistTranslationCache } from "./translate.js";
import { processImages, processPdfs } from "./images.js";
import { buildSlug, buildSeo } from "./seo.js";
import { dedupe } from "./dedupe.js";
import { commit, writeSyncLog, loadState, readProductFile, productKey } from "./store.js";
import { writeSitemap } from "./sitemap.js";
import { writeSearchIndex } from "./searchindex.js";
import { writeRobots } from "./robots.js";
import { slugify, productHash } from "./util.js";

const STATE = loadState();

async function main() {
  const started = Date.now();
  log.step("TrendHolic product sync starting");
  log.info(`source=${CONFIG.source.baseUrl} render=${CONFIG.source.render} ` +
           `translate=${CONFIG.translate.provider} dryRun=${CONFIG.dryRun}`);

  // ---- PREFLIGHT: authorized-access / robots.txt permission -----------------
  // If the supplier's robots.txt disallows automated crawling, abort safely and
  // preserve the last-known-good catalog. Do NOT bypass. (Requirements 11/13/14.)
  if (CONFIG.source.respectRobots && !(await robotsAllows(CONFIG.source.baseUrl.replace(/\/$/, "") + "/"))) {
    log.error(`ABORT: automated access not permitted — ${await robotsStatus()}.`);
    log.error("No crawl performed. Last-known-good catalog preserved (nothing overwritten).");
    log.error("Authorized access required — choose ONE: (a) an official data feed/API/CSV/XML export from the");
    log.error("supplier; (b) the supplier updates robots.txt to permit your bot; or (c) you provide explicit");
    log.error("written authorization to crawl despite robots.txt, then set IGNORE_ROBOTS=1 knowingly.");
    log.flush({ aborted: "robots_disallow" });
    await closeBrowser();
    process.exit(3);
  }

  const categories = await safe(() => crawl.getCategories(), "getCategories", []);
  if (!categories.length) {
    log.error("No categories found. Seed SEED_CATEGORIES or calibrate adapter.discoverCategories.");
  }

  const allProducts = [];
  const crawledCategorySlugs = new Set();

  for (const category of categories) {
    const catSlug = slugify(category.name || category.url);
    log.count.categories++;
    log.step(`Category: ${category.name || catSlug}`);
    let urls;
    try {
      urls = await crawl.getProductUrls(category);
    } catch (e) {
      log.fail(`category listing ${category.url}`, e);
      continue; // category not crawled → its products are preserved, not deleted
    }
    log.count.productUrls += urls.length;
    log.info(`  ${urls.length} product URL(s)`);

    const run = limiter(CONFIG.crawl.concurrency);
    const results = await Promise.all(urls.map((url) => run(async () => {
      try {
        const raw = await crawl.fetchProduct(url);
        const product = await buildProduct(raw, category, catSlug);
        log.ok(`  ${product.sku || product.slug}`);
        return product;
      } catch (e) { log.fail(`product ${url}`, e); return null; }
    })));

    const products = results.filter(Boolean);
    // a category counts as "crawled" if we obtained its listing (even if some
    // individual products failed) — enables safe deletion within it.
    crawledCategorySlugs.add(catSlug);
    products.forEach((p) => allProducts.push(p));
  }

  // ---- SAFETY GUARD: never wipe a good catalog on a bad/empty crawl ---------
  // If we obtained zero products but a previous catalog exists, treat the source
  // as unavailable, abort WITHOUT overwriting outputs, and preserve last-good.
  if (allProducts.length === 0 && Object.keys(STATE.products).length > 0) {
    log.error("ABORT: crawl produced 0 products but a previous catalog exists — source likely unavailable.");
    log.error("Nothing overwritten; last-known-good catalog preserved. (Requirement 13.)");
    log.flush({ aborted: "zero_products_guard" });
    await closeBrowser();
    process.exit(4);
  }

  // global de-duplication (removes duplicate products across the whole crawl)
  const deduped = dedupe(allProducts);
  log.info(`Products: ${allProducts.length} crawled → ${deduped.length} after de-dup`);

  // group into catalog { categorySlug: { category, products } }
  const catalog = {};
  for (const p of deduped) {
    (catalog[p.categorySlug] ??= { category: { name: p.category, slug: p.categorySlug, sourceUrl: p.categorySourceUrl }, products: [] })
      .products.push(p);
  }

  // persist
  const report = commit(catalog, crawledCategorySlugs);
  writeSitemap(catalog);
  writeRobots();
  writeSearchIndex(catalog);
  persistTranslationCache();

  const logResult = log.flush({ durationMs: Date.now() - started });
  writeSyncLog(report, logResult);
  await closeBrowser();

  log.step("Summary");
  const c = logResult.counters;
  log.info(`categories=${c.categories} productUrls=${c.productUrls}`);
  log.info(`new=${report.added.length} updated=${report.updated.length} unchanged=${report.unchanged} removed=${report.removed.length}`);
  log.info(`translated=${c.translated} translateFailures=${c.translateFailed} images=${c.images} downloadFailures=${c.downloadFailed} crawlFailures=${c.failed}`);
  log.info("Done.");
}

async function buildProduct(raw, category, catSlug) {
  // ---- incremental: reuse unchanged products (no re-translate / re-download) ----
  const rawHash = productHash(raw);                      // hash of the raw extraction
  const key = productKey(raw);
  const prev = STATE.products[key];
  if (prev && prev.rawHash === rawHash && !CONFIG.dryRun) {
    const cached = readProductFile(prev.slug);
    if (cached) {
      log.count.unchanged++; log.skip(`  ${raw.sku || prev.slug} (unchanged)`);
      cached._rawHash = rawHash;
      cached.category = category.name; cached.categorySlug = catSlug; cached.categorySourceUrl = category.url;
      return cached;
    }
  }

  // ---- full build ----
  const product = { ...raw, category: category.name, categorySlug: catSlug, categorySourceUrl: category.url };
  await translateProduct(product);                       // req 5 (brand/model/measurements preserved)
  product.slug = buildSlug(product, category);           // SEO slug
  product.images = await processImages(product, catSlug, product.slug); // download+compress+alt (never hotlink)
  product.pdfs = await processPdfs(product, catSlug, product.slug);
  product.seo = buildSeo(product, category);             // title/description/keywords/canonical
  product.syncedAt = new Date().toISOString();
  product._rawHash = rawHash;
  return product;
}

async function safe(fn, label, fallback) {
  try { return await fn(); } catch (e) { log.fail(label, e); return fallback; }
}

main().catch((e) => {
  log.error(`FATAL: ${e.stack || e.message}`);
  try { log.flush({ fatal: e.message }); } catch {}
  process.exit(1);
});
