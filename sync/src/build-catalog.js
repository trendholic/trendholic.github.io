// ============================================================================
// build-catalog.js — assemble the unified TrendHolic catalog from the 4 sources.
// Reads data/<top>/{categories.json, products/*.json} and writes:
//   data/catalog/_index.json         (top categories + discovered subcategories)
//   data/catalog/<top>.json          (products under each top category)
//   data/search-index.json           (unified search)
//   sitemap.xml, robots.txt          (SEO; canonical = TrendHolic URLs)
// Never exposes supplier URLs as canonical.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import { slugify, truncate } from "./util.js";

const dataDir = CONFIG.out.dataDir;
const base = CONFIG.out.siteBaseUrl.replace(/\/$/, "");
const cp = CONFIG.out.catalogPublicPath.replace(/\/$/, ""); // "/catalog"
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2)); };

function seoFor(p) {
  return {
    title: truncate(`${p.name} | TrendHolic ${p.top_category}`, 65),
    description: truncate(`${p.name} — ${p.top_category}. View images and details in the TrendHolic catalog.`, 155),
    canonical: `${base}${cp}/product/${p.slug}/`,
    og_image: p.images?.[0]?.src ? base + p.images[0].src : null,
  };
}

function main() {
  const topCategories = [];
  const allRecords = [];
  const catalogByTop = {};

  for (const src of CONFIG.sources) {
    const topSlug = slugify(src.top);
    const prodDir = path.join(dataDir, topSlug, "products");
    const cats = readJson(path.join(dataDir, topSlug, "categories.json"), { categories: [] });
    let products = [];
    if (fs.existsSync(prodDir)) {
      for (const f of fs.readdirSync(prodDir).filter((f) => f.endsWith(".json"))) {
        const p = readJson(path.join(prodDir, f), null); if (!p) continue;
        p.seo = seoFor(p);
        products.push(p);
        allRecords.push({
          slug: p.slug, name: p.name, top: p.top_category, topSlug,
          brand: p.brand || "", model: p.model_number || "", sku: p.sku || "",
          category: p.source_category || "", source: p.source_site, source_domain: p.source_domain,
          image: p.images?.[0]?.src || null,
          url: `${cp}/product/${p.slug}/`,
          canonical: p.seo.canonical,
          keywords: [p.name, p.top_category, p.source_category].filter(Boolean),
        });
      }
    }
    const srcHost = (() => { try { return new URL(src.baseUrl).host; } catch { return `${src.key}.tangma2088.com`; } })();
    catalogByTop[topSlug] = { top: src.top, slug: topSlug, source_domain: srcHost,
      subcategoriesDiscovered: cats.categories?.length || 0,
      subcategories: (cats.categories || []).map((c) => ({ name: c.name, slug: c.slug, source_path: c.source_path })),
      productCount: products.length, products };
    writeJson(path.join(CONFIG.out.catalogDir, `${topSlug}.json`), catalogByTop[topSlug]);
    topCategories.push({ name: src.top, slug: topSlug, productCount: products.length,
      subcategoriesDiscovered: cats.categories?.length || 0 });
  }

  // catalog index
  writeJson(path.join(CONFIG.out.catalogDir, "_index.json"), {
    updatedAt: new Date().toISOString(),
    topCategories,
    totals: {
      topCategories: topCategories.length,
      products: allRecords.length,
      subcategoriesDiscovered: topCategories.reduce((n, t) => n + t.subcategoriesDiscovered, 0),
    },
  });

  // unified search index
  writeJson(CONFIG.out.searchIndex, { updatedAt: new Date().toISOString(), count: allRecords.length, records: allRecords });

  // sitemap.xml (canonical TrendHolic URLs only)
  const now = new Date().toISOString().slice(0, 10);
  const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
  const urls = [`${base}/`, `${base}${cp}/`];
  for (const t of topCategories) urls.push(`${base}${cp}/${t.slug}/`);
  for (const r of allRecords) urls.push(r.canonical);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${xml(u)}</loc><lastmod>${now}</lastmod></url>`).join("\n") + `\n</urlset>\n`;
  fs.writeFileSync(CONFIG.out.sitemap, sitemap);

  // robots.txt
  fs.writeFileSync(path.join(CONFIG.out.repoRoot, "robots.txt"),
    `# managed-by: trendholic-product-sync\nUser-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

  console.log(JSON.stringify({
    topCategories: topCategories.map((t) => `${t.name}:${t.productCount}p/${t.subcategoriesDiscovered}c`),
    totalProducts: allRecords.length,
    searchRecords: allRecords.length,
    sitemapUrls: urls.length,
  }, null, 2));
}
main();
