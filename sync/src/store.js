// store.js — JSON "database" with upsert + safe deletion diffing.
//   * Per-category JSON files (preserving hierarchy).
//   * Per-product JSON files.
//   * A state file used to detect added / updated / unchanged / removed.
//   * Deletions are applied ONLY within categories that crawled successfully,
//     so a partial failure can never mass-delete the catalog.
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import log from "./logger.js";
import { productHash, slugify, sha1 } from "./util.js";

// Stable identity for a product across runs: SKU when present, else source URL.
// Independent of the (translation-derived) slug, so keys never drift.
export const productKey = (p) =>
  p.sku ? "sku:" + slugify(p.sku, 60) : "url:" + sha1(p.sourceUrl || p.slug || p.name || "");

const write = (file, obj) => {
  if (CONFIG.dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
};
const rm = (p) => { try { if (!CONFIG.dryRun) fs.rmSync(p, { force: true }); } catch {} };

export function loadState() {
  try { return JSON.parse(fs.readFileSync(CONFIG.out.stateFile, "utf8")); }
  catch { return { products: {}, categories: [], updatedAt: null }; }
}

// Load a previously-written product JSON (used by incremental sync to reuse
// unchanged products without re-translating or re-downloading assets).
export function readProductFile(slug) {
  try { return JSON.parse(fs.readFileSync(path.join(CONFIG.out.productsDir, `${slug}.json`), "utf8")); }
  catch { return null; }
}

const keyOf = productKey;

// catalog: { [categorySlug]: { category:{name,slug,sourceUrl}, products:[...] } }
// crawledCategorySlugs: Set of categories that completed without a hard error.
export function commit(catalog, crawledCategorySlugs) {
  const prev = loadState();
  const nextState = { products: {}, categories: [], updatedAt: new Date().toISOString() };
  const report = { added: [], updated: [], unchanged: 0, removed: [], categories: 0 };

  // ---- upsert per category ----
  for (const [slug, { category, products }] of Object.entries(catalog)) {
    report.categories++;
    nextState.categories.push({ name: category.name, slug, sourceUrl: category.sourceUrl, count: products.length });

    for (const p of products) {
      const k = keyOf(p);
      const hash = productHash(p);
      const before = prev.products[k];
      if (!before) report.added.push(p.sku || p.slug);
      else if (before.hash !== hash) report.updated.push(p.sku || p.slug);
      else report.unchanged++;
      nextState.products[k] = {
        hash, rawHash: p._rawHash || null, category: slug, slug: p.slug, sku: p.sku || null,
        sourceUrl: p.sourceUrl, firstSeen: before?.firstSeen || nextState.updatedAt, lastSeen: nextState.updatedAt,
      };
      const { _rawHash, ...clean } = p;       // keep internal fields out of the file
      write(path.join(CONFIG.out.productsDir, `${p.slug}.json`), clean);
    }

    write(path.join(CONFIG.out.catalogDir, `${slug}.json`), {
      category: category.name, slug, sourceUrl: category.sourceUrl,
      updatedAt: nextState.updatedAt, count: products.length, products,
    });
  }

  // ---- safe deletion: keys present before, absent now, in a crawled category ----
  for (const [k, meta] of Object.entries(prev.products)) {
    if (nextState.products[k]) continue;
    if (!crawledCategorySlugs.has(meta.category)) { nextState.products[k] = meta; continue; } // preserve (category not crawled)
    report.removed.push(meta.sku || meta.slug);
    rm(path.join(CONFIG.out.productsDir, `${meta.slug}.json`));
    // orphaned images/manuals for this product
    rm(path.join(CONFIG.out.imagesDir, meta.category)); // dir cleaned lazily below
  }

  // rebuild category files already reflect current products; nothing else to prune here.
  write(CONFIG.out.stateFile, nextState);

  // ---- catalog index (list of categories) ----
  write(path.join(CONFIG.out.catalogDir, "_index.json"), {
    updatedAt: nextState.updatedAt,
    categories: nextState.categories,
  });

  return report;
}

export function writeSyncLog(report, logResult) {
  const c = logResult.counters;
  write(CONFIG.out.syncLog, {
    finishedAt: new Date().toISOString(),
    added: report.added.length,
    updated: report.updated.length,
    unchanged: report.unchanged,
    removed: report.removed.length,
    categories: report.categories,
    crawlStats: { categories: c.categories, productUrls: c.productUrls, productsOk: c.ok },
    translationFailures: c.translateFailed,
    downloadFailures: c.downloadFailed,
    crawlFailures: c.failed,
    failures: c.failed,
    detail: { new: report.added, updated: report.updated, removed: report.removed },
    failureLog: logResult.failures.slice(0, 200),
  });
}
