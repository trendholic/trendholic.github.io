// util.js — small pure helpers shared across the pipeline.
import crypto from "node:crypto";

export const cleanText = (s) =>
  String(s ?? "").replace(/\s+/g, " ").replace(/ /g, " ").trim();

export const textOf = ($, sel) => cleanText($(sel).first().text());

export function absolute(base, href) {
  if (!href) return null;
  try { return new URL(href, base).toString().split("#")[0]; } catch { return null; }
}

// SEO-friendly slug (ASCII, lowercase, hyphenated). Keeps digits + letters.
export function slugify(str, max = 70) {
  const s = String(str ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")   // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return (s || "item").slice(0, max).replace(/-+$/, "");
}

export const sha1 = (s) => crypto.createHash("sha1").update(String(s)).digest("hex");

export function truncate(s, n) {
  const t = cleanText(s);
  if (t.length <= n) return t;
  return t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

// stable content hash of the meaningful product fields (for change detection)
export function productHash(p) {
  return sha1(JSON.stringify({
    name: p.name, sku: p.sku, brand: p.brand, model: p.modelNumber,
    description: p.description, specifications: p.specifications,
    features: p.features, variations: p.variations,
    images: (p.images || []).map((i) => i.src || i),
    pdfs: p.pdfs,
  }));
}
