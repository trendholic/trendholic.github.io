// dedupe.js — remove duplicate products. Primary key: normalized SKU.
// Fallback key: normalized brand+name. Later duplicates merge their images
// into the first occurrence rather than being dropped blindly.
import { slugify } from "./util.js";

const norm = (s) => slugify(String(s ?? ""), 120);

export function dedupe(products) {
  const bySku = new Map();
  const byName = new Map();
  const result = [];

  for (const p of products) {
    const skuKey = p.sku ? "sku:" + norm(p.sku) : null;
    const nameKey = "nm:" + norm([p.brand, p.name].filter(Boolean).join(" "));
    const existing = (skuKey && bySku.get(skuKey)) || byName.get(nameKey);

    if (existing) {
      // merge unique images / pdfs into the kept record
      mergeArrays(existing, p, "images", (x) => x.url || x.src || x);
      mergeArrays(existing, p, "pdfs", (x) => x.url || x.src || x);
      if (!existing.description && p.description) existing.description = p.description;
      continue;
    }
    result.push(p);
    if (skuKey) bySku.set(skuKey, p);
    byName.set(nameKey, p);
  }
  return result;
}

function mergeArrays(target, src, field, idOf) {
  const a = target[field] || [], b = src[field] || [];
  const seen = new Set(a.map(idOf));
  for (const item of b) { const id = idOf(item); if (!seen.has(id)) { a.push(item); seen.add(id); } }
  target[field] = a;
}
