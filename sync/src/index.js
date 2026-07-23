// ============================================================================
// index.js — orchestrator. Crawl → translate → images → SEO → dedupe → store
//            → sitemap → search index → logs. Per-item failures never stop it.
// ============================================================================
import CONFIG from "../config.js";
import log from "./logger.js";
import { limiter } from "./http.js";
import { closeBrowser } from "./browser.js";
import * as crawl from "./crawl.js";
import { translateProduct, persistTranslationCache } from "./translate.js";
import { processImages, processPdfs } from "./images.js";
import { buildSlug, buildSeo } from "./seo.js";
import { dedupe } from "./dedupe.js";
import { commit, writeSyncLog } from "./store.js";
import { writeSitemap } from "./sitemap.js";
import { writeSearchIndex } from "./searchindex.js";
import { slugify } from "./util.js";

async function main() {
  const started = Date.now();
  log.step("TrendHolic product sync starting");
  log.info(`source=${CONFIG.source.baseUrl} render=${CONFIG.source.render} ` +
           `translate=${CONFIG.translate.provider} dryRun=${CONFIG.dryRun}`);

  const categories = await safe(() => crawl.getCategories(), "getCategories", []);
  if (!categories.length) {
    log.error("No categories found. Seed SEED_CATEGORIES or calibrate adapter.discoverCategories.");
  }

  const allProducts = [];
  const crawledCategorySlugs = new Set();

  for (const category of categories) {
    const catSlug = slugify(category.name || category.url);
    log.step(`Category: ${category.name || catSlug}`);
    let urls;
    try {
      urls = await crawl.getProductUrls(category);
    } catch (e) {
      log.fail(`category listing ${category.url}`, e);
      continue; // category not crawled → its products are preserved, not deleted
    }
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
  writeSearchIndex(catalog);
  persistTranslationCache();

  const logResult = log.flush({ durationMs: Date.now() - started });
  writeSyncLog(report, logResult);
  await closeBrowser();

  log.step("Summary");
  log.info(`added=${report.added.length} updated=${report.updated.length} ` +
           `unchanged=${report.unchanged} removed=${report.removed.length} ` +
           `failures=${logResult.counters.failed} images=${log.count.images} translated=${log.count.translated}`);
  log.info("Done.");
}

async function buildProduct(raw, category, catSlug) {
  const product = { ...raw, category: category.name, categorySlug: catSlug, categorySourceUrl: category.url };
  await translateProduct(product);                       // req 4/5 (brand/model preserved)
  product.slug = buildSlug(product, category);           // SEO slug
  product.images = await processImages(product, catSlug, product.slug); // download+compress+alt
  product.pdfs = await processPdfs(product, catSlug, product.slug);
  product.seo = buildSeo(product, category);             // title/description/keywords/canonical
  product.syncedAt = new Date().toISOString();
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
