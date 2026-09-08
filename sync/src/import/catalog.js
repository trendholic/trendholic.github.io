import fs from 'node:fs';
import path from 'node:path';
import { assertPublic, requireValue } from './core.js';

export function importedCatalog(repo, sources) {
  const file = path.join(repo, 'data/imported/products.json');
  if (!fs.existsSync(file)) return { sources, byTop: new Map() };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  requireValue(Array.isArray(manifest.products), 'PUBLIC_SCHEMA');
  const byTop = new Map(), expanded = sources.map(s => ({ ...s })), seen = new Set();
  for (const p of manifest.products) {
    assertPublic(p);
    requireValue(!seen.has(p.slug), 'DUPLICATE_PRODUCT'); seen.add(p.slug);
    for (const im of p.images) requireValue(fs.existsSync(path.join(repo, im.src.slice(1))), 'MISSING_PUBLIC_IMAGE');
    const found = expanded.find(s => (s.slug || s.top.toLowerCase().replace(/\s+/g, '-')) === p.category_slug);
    if (found) requireValue(found.top === p.top_category, 'CATEGORY_COLLISION');
    else expanded.push({ key: p.category_slug, top: p.top_category, slug: p.category_slug, importedOnly: true });
    if (!byTop.has(p.category_slug)) byTop.set(p.category_slug, []);
    byTop.get(p.category_slug).push(p);
  }
  return { sources: expanded, byTop };
}
