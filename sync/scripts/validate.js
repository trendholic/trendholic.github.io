// validate.js — post-sync validation gate. The nightly workflow runs this
// BEFORE committing/deploying; a non-zero exit blocks the deploy.
// Checks: catalog index + category JSON parse, product files parse, search
// index parses, sitemap is well-formed, and no obviously-broken records.
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";

let errors = 0;
const fail = (m) => { console.error("VALIDATE FAIL:", m); errors++; };
const ok = (m) => console.log("VALIDATE OK:", m);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function main() {
  // catalog index
  const idxPath = path.join(CONFIG.out.catalogDir, "_index.json");
  if (!fs.existsSync(idxPath)) { fail("data/catalog/_index.json missing (did the sync run?)"); return finish(); }
  const idx = safe(() => readJson(idxPath), "catalog/_index.json");
  if (idx) ok(`${idx.categories?.length ?? 0} categories`);

  // each category file + product references
  let productCount = 0;
  for (const c of idx?.categories || []) {
    const cf = path.join(CONFIG.out.catalogDir, `${c.slug}.json`);
    const cat = safe(() => readJson(cf), `catalog/${c.slug}.json`);
    if (!cat) continue;
    for (const p of cat.products || []) {
      productCount++;
      if (!p.name) fail(`product without name in ${c.slug}`);
      if (!p.slug) fail(`product without slug in ${c.slug}`);
      for (const img of p.images || []) {
        if (img.src && img.src.startsWith("http")) fail(`hotlinked image not localized: ${img.src}`);
      }
    }
  }
  ok(`${productCount} products validated`);

  // search index
  if (fs.existsSync(CONFIG.out.searchIndex)) {
    const si = safe(() => readJson(CONFIG.out.searchIndex), "search-index.json");
    if (si) ok(`search index: ${si.count} records`);
  } else fail("search-index.json missing");

  // sitemap well-formedness (lightweight)
  if (fs.existsSync(CONFIG.out.sitemap)) {
    const xml = fs.readFileSync(CONFIG.out.sitemap, "utf8");
    if (!/<urlset[\s\S]*<\/urlset>/.test(xml)) fail("sitemap.xml malformed");
    else ok("sitemap.xml well-formed");
  } else fail("sitemap.xml missing");

  finish();
}
function safe(fn, label) { try { return fn(); } catch (e) { fail(`${label}: ${e.message}`); return null; } }
function finish() {
  if (errors) { console.error(`\n${errors} validation error(s). Deploy blocked.`); process.exit(1); }
  console.log("\nAll validations passed.");
}
main();
