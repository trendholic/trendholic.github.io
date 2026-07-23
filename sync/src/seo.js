// seo.js — generate SEO metadata: title, description, keywords, slug, alt base.
import CONFIG from "../config.js";
import { slugify, truncate } from "./util.js";

export function buildSlug(product, category) {
  // Prefer a stable, human + SEO friendly slug: brand-name-sku.
  const base = [product.brand, product.name].filter(Boolean).join(" ");
  const skuPart = product.sku ? "-" + slugify(product.sku, 24) : "";
  return (slugify(base, 60) + skuPart).replace(/-+$/, "") || slugify(category.name + "-" + (product.sku || "item"));
}

export function buildSeo(product, category) {
  const brand = product.brand ? product.brand + " " : "";
  const title = truncate(`${brand}${product.name}${product.sku ? " (" + product.sku + ")" : ""} | TrendHolic`, 65);
  const description = truncate(
    product.description || `${brand}${product.name} — ${category.name}. Specifications, features and manuals.`,
    155
  );
  const kw = new Set();
  [product.brand, product.name, category.name, product.modelNumber, product.sku]
    .filter(Boolean).forEach((s) => String(s).split(/\s+/).forEach((w) => { if (w.length > 2) kw.add(w.toLowerCase()); }));
  (product.features || []).slice(0, 5).forEach((f) => kw.add(slugify(f, 30).replace(/-/g, " ")));
  const keywords = [...kw].filter(Boolean).slice(0, 15);

  return {
    title,
    description,
    keywords,
    canonical: `${CONFIG.out.siteBaseUrl}${CONFIG.out.catalogPublicPath}${slugify(category.name)}/${product.slug}.html`,
    altBase: [product.brand, product.name].filter(Boolean).join(" ") || product.name,
  };
}
