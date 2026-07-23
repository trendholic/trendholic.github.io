// validate.js — pre-deployment validation for the unified multi-source catalog.
// Real checks against generated data. Non-zero exit BLOCKS deployment.
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";

let errors = 0, warns = 0;
const fail = (m) => { console.error("FAIL:", m); errors++; };
const warn = (m) => { console.warn("warn:", m); warns++; };
const ok = (m) => console.log("ok:", m);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const abs = (rel) => path.join(CONFIG.out.repoRoot, rel.replace(/^\//, ""));
const TOP_SLUGS = CONFIG.sources.map((s) => s.top.toLowerCase());

function main() {
  const idxPath = path.join(CONFIG.out.catalogDir, "_index.json");
  if (!fs.existsSync(idxPath)) { fail("data/catalog/_index.json missing — run the sync + build first"); return finish(); }
  const idx = readJson(idxPath);
  if (!idx.topCategories?.length) fail("catalog index has no top categories");
  else ok(`${idx.topCategories.length} top categories`);

  const slugs = new Set();
  const parentByTop = new Map();
  let totalProducts = 0, totalImages = 0, sourcesWithProducts = 0;

  for (const src of CONFIG.sources) {
    const topSlug = src.top.toLowerCase();
    const prodDir = path.join(CONFIG.out.dataDir, topSlug, "products");
    if (!fs.existsSync(prodDir)) { warn(`${src.top}: no products dir (source may have been BLOCKED/FAILED)`); continue; }
    const files = fs.readdirSync(prodDir).filter((f) => f.endsWith(".json"));
    if (files.length) sourcesWithProducts++;
    for (const f of files) {
      totalProducts++;
      let p; try { p = readJson(path.join(prodDir, f)); } catch (e) { fail(`${topSlug}/${f}: invalid JSON (${e.message})`); continue; }
      // stable id + slug
      if (!p.slug) fail(`${f}: no slug`);
      if (slugs.has(p.slug)) fail(`duplicate physical-product slug: ${p.slug}`); else slugs.add(p.slug);
      if (!p.parent_product_id && !p.source_parent_product_id) warn(`${p.slug}: no parent/product id`);
      // correct top category
      if ((p.top_category || "").toLowerCase() !== topSlug) fail(`${p.slug}: top_category '${p.top_category}' != '${src.top}'`);
      // provenance
      for (const k of ["source_site", "source_domain", "source_product_url", "source_top_category"])
        if (!p[k]) fail(`${p.slug}: missing provenance ${k}`);
      // canonical must be a TrendHolic URL, never the supplier
      if (!String(p.source_canonical_url || "").startsWith(CONFIG.out.siteBaseUrl)) fail(`${p.slug}: canonical not a TrendHolic URL`);
      // name present
      if (!p.name || !p.name.trim()) fail(`${p.slug}: empty name`);
      // images: local only, on disk, no hotlinks
      if (!p.images?.length) warn(`${p.slug}: 0 images`);
      for (const im of p.images || []) {
        totalImages++;
        if (!im.src || im.src.startsWith("http")) { fail(`${p.slug}: hotlinked/invalid image src ${im.src}`); continue; }
        if (!fs.existsSync(abs(im.src))) fail(`${p.slug}: broken local image ${im.src}`);
      }
      // duplicate-physical detection within a top by parent id
      const key = `${topSlug}:${p.parent_product_id}`;
      if (p.parent_product_id) { if (parentByTop.has(key)) fail(`duplicate physical product (same parent id) ${key}`); else parentByTop.set(key, p.slug); }
    }
  }
  ok(`${totalProducts} physical products, ${totalImages} local images, ${sourcesWithProducts}/4 sources with products`);
  if (totalProducts === 0) fail("catalog has zero products — refusing to deploy an empty catalog");

  // search index
  if (fs.existsSync(CONFIG.out.searchIndex)) {
    const si = readJson(CONFIG.out.searchIndex);
    if (si.count !== totalProducts) warn(`search index count ${si.count} != products ${totalProducts}`);
    else ok(`search index: ${si.count} records`);
    for (const r of si.records || []) if (r.image && r.image.startsWith("http")) fail(`search record ${r.slug}: hotlinked image`);
  } else fail("search-index.json missing");

  // sitemap: well-formed + canonical TrendHolic only
  const smPath = CONFIG.out.sitemap;
  if (fs.existsSync(smPath)) {
    const xml = fs.readFileSync(smPath, "utf8");
    if (!/<urlset[\s\S]*<\/urlset>/.test(xml)) fail("sitemap.xml malformed");
    else if (/tangma2088\.com/.test(xml)) fail("sitemap exposes supplier URLs");
    else ok("sitemap.xml valid (TrendHolic canonical URLs)");
  } else fail("sitemap.xml missing");

  // robots.txt
  if (fs.existsSync(path.join(CONFIG.out.repoRoot, "robots.txt"))) ok("robots.txt present"); else fail("robots.txt missing");

  finish();
}
function finish() {
  console.log(`\n${errors} error(s), ${warns} warning(s).`);
  if (errors) { console.error("VALIDATION FAILED — deployment blocked."); process.exit(1); }
  console.log("VALIDATION PASSED.");
}
main();
