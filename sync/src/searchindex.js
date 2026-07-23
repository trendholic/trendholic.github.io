// searchindex.js — regenerate the catalog search index after every sync.
// A compact JSON array the (optional) catalog viewer / any client can fetch.
import fs from "node:fs";
import CONFIG from "../config.js";

export function writeSearchIndex(catalog) {
  if (CONFIG.dryRun) return;
  const records = [];
  for (const [slug, { category, products }] of Object.entries(catalog)) {
    for (const p of products) {
      records.push({
        slug: p.slug,
        name: p.name,
        brand: p.brand || "",
        model: p.modelNumber || "",
        sku: p.sku || "",
        category: category.name,
        categorySlug: slug,
        keywords: p.seo?.keywords || [],
        image: (p.images && p.images[0] && p.images[0].src) || null,
        url: `${CONFIG.out.catalogPublicPath}${slug}/${p.slug}.html`,
      });
    }
  }
  fs.mkdirSync(CONFIG.out.dataDir, { recursive: true });
  fs.writeFileSync(CONFIG.out.searchIndex, JSON.stringify({ updatedAt: new Date().toISOString(), count: records.length, records }));
}
