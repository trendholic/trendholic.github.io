// adapters/index.js — adapter registry. Selects the site adapter by hostname,
// falling back to a generic adapter. Add a new supplier by dropping in one file
// and registering it here.
import { createAdapter } from "./base.js";
import tangma2088, { hostMatch as tangmaMatch, SELECTORS as tangmaSel } from "./tangma2088.js";

// Generic fallback (JSON-LD/OG heavy, loose CSS). Works for many stores as-is.
const GENERIC = createAdapter({
  categoryLinks: "nav a, .category a, .menu a, .product-category a",
  productLinks: ".product a, .product-item a, li.item a, .card a",
  nextPage: "a.next, .pagination a[rel='next'], a[rel='next']",
  categoryTitle: "h1, .page-title",
  name: "h1, .product-title",
  sku: "[itemprop='sku'], .sku",
  brand: "[itemprop='brand'], .brand",
  modelNumber: "[itemprop='model'], .model",
  description: "[itemprop='description'], #description, .description",
  specsTable: "table.spec, .specifications table, table",
  features: ".features li, #features li",
  technicalData: ".technical, #technical",
  images: "[itemprop='image'], .product-image img, .gallery img",
  pdfLinks: "a[href$='.pdf']",
  variations: ".variations option, .variant",
});

const REGISTRY = [
  { match: tangmaMatch, adapter: tangma2088, id: "tangma2088" },
];

export function getAdapter(baseUrl) {
  let host = ""; try { host = new URL(baseUrl).host; } catch { /* noop */ }
  const hit = REGISTRY.find((r) => r.match(host));
  return { id: hit?.id || "generic", adapter: hit?.adapter || GENERIC };
}

export { tangmaSel };
