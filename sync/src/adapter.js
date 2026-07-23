// ============================================================================
// adapter.js  ★★★ THE ONE FILE YOU CALIBRATE TO THE REAL SUPPLIER SITE ★★★
// ----------------------------------------------------------------------------
// Everything else is site-agnostic. This module turns the supplier's HTML into
// normalized objects. It ships with sensible generic strategies (schema.org
// JSON-LD, OpenGraph meta, then CSS selectors) so it can often work out of the
// box — but the CSS selectors below MUST be verified against real pages, since
// macc.tangma2088.com returned 503 to inspection and its DOM is unknown here.
//
// HOW TO CALIBRATE:
//   1. Open a real category page + product page in a browser.
//   2. Copy the CSS selectors into SELECTORS below.
//   3. Run:  DRY_RUN=1 MAX_PRODUCTS_PER_CATEGORY=2 npm run sync   and inspect.
// ============================================================================
import { absolute, textOf, cleanText } from "./util.js";

// ---- CSS selectors — CALIBRATE THESE ---------------------------------------
export const SELECTORS = {
  // Homepage navigation → category links
  categoryLinks: "nav a, .category a, .menu a, .product-category a",
  // Category listing page
  productLinks: ".product a, .product-item a, .goods-item a, li.item a",
  nextPage: "a.next, .pagination a[rel='next'], .page-next a",
  categoryTitle: "h1, .category-title, .page-title",
  // Product page
  name: "h1, .product-title, .goods-title",
  sku: "[itemprop='sku'], .sku, .product-sku, .item-sku",
  brand: "[itemprop='brand'], .brand, .product-brand",
  description: "#description, .product-description, .description, [itemprop='description']",
  specsTable: ".specifications table, #specs table, table.spec",
  features: ".features li, #features li, .product-features li",
  images: ".product-gallery img, .gallery img, [itemprop='image'], .product-image img",
  pdfLinks: "a[href$='.pdf'], a[href*='manual'], a[href*='datasheet']",
  variations: ".variations option, .sku-list li, .variant",
  modelNumber: ".model, [itemprop='model'], .product-model",
};

// ---- category discovery from homepage --------------------------------------
export function discoverCategories($, baseUrl) {
  const out = new Map();
  $(SELECTORS.categoryLinks).each((_, el) => {
    const href = $(el).attr("href"); if (!href) return;
    const url = absolute(baseUrl, href);
    if (!url || !url.startsWith(baseUrl)) return;
    const name = cleanText($(el).text());
    if (name && !out.has(url)) out.set(url, { name, url });
  });
  return [...out.values()];
}

// ---- category listing → product urls + pagination --------------------------
export function parseCategory($, pageUrl, baseUrl) {
  const productUrls = [];
  $(SELECTORS.productLinks).each((_, el) => {
    const href = $(el).attr("href");
    const url = absolute(baseUrl, href);
    if (url && url.startsWith(baseUrl)) productUrls.push(url);
  });
  const nextHref = $(SELECTORS.nextPage).first().attr("href");
  const nextPage = nextHref ? absolute(baseUrl, nextHref) : null;
  const title = cleanText($(SELECTORS.categoryTitle).first().text());
  return { productUrls: [...new Set(productUrls)], nextPage, title };
}

// ---- product page → raw normalized product ---------------------------------
// Strategy order: schema.org JSON-LD → OpenGraph meta → CSS selectors.
export function parseProduct($, url, baseUrl) {
  const ld = readJsonLdProduct($);
  const p = {
    sourceUrl: url,
    name: ld.name || textOf($, SELECTORS.name) || $("meta[property='og:title']").attr("content") || "",
    sku: ld.sku || textOf($, SELECTORS.sku) || "",
    brand: ld.brand || textOf($, SELECTORS.brand) || "",
    modelNumber: ld.mpn || textOf($, SELECTORS.modelNumber) || "",
    description: ld.description || textOf($, SELECTORS.description)
      || $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "",
    specifications: extractSpecs($),
    features: extractList($, SELECTORS.features),
    technicalData: "", // often overlaps specs; calibrate if the site separates them
    variations: extractList($, SELECTORS.variations),
    images: extractImages($, baseUrl, ld),
    pdfs: extractPdfs($, baseUrl),
  };
  return p;
}

// ---- helpers ---------------------------------------------------------------
function readJsonLdProduct($) {
  let found = {};
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const arr = Array.isArray(data) ? data : (data["@graph"] || [data]);
      for (const node of arr) {
        if (node && /product/i.test(String(node["@type"] || ""))) {
          found = {
            name: node.name, sku: node.sku, mpn: node.mpn,
            brand: typeof node.brand === "object" ? node.brand?.name : node.brand,
            description: node.description,
            image: [].concat(node.image || []).filter(Boolean),
          };
        }
      }
    } catch { /* ignore malformed ld+json */ }
  });
  return found;
}

function extractSpecs($) {
  const rows = [];
  $(SELECTORS.specsTable).find("tr").each((_, tr) => {
    const cells = $(tr).find("th,td");
    if (cells.length >= 2) {
      const k = cleanText($(cells[0]).text()); const v = cleanText($(cells[1]).text());
      if (k) rows.push(`${k}: ${v}`);
    }
  });
  return rows.join("\n");
}

function extractList($, sel) {
  const out = [];
  $(sel).each((_, el) => { const t = cleanText(useText($, el)); if (t) out.push(t); });
  return out;
}
function useText($, el) { return $(el).attr("value") || $(el).text(); }

function extractImages($, baseUrl, ld) {
  const urls = new Set();
  (ld.image || []).forEach((u) => { const a = absolute(baseUrl, u); if (a) urls.add(a); });
  $(SELECTORS.images).each((_, el) => {
    const raw = $(el).attr("data-zoom-image") || $(el).attr("data-large") ||
                $(el).attr("data-src") || $(el).attr("src") || $(el).attr("content");
    const a = absolute(baseUrl, raw);
    if (a && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(a)) urls.add(a);
  });
  return [...urls];
}

function extractPdfs($, baseUrl) {
  const out = new Set();
  $(SELECTORS.pdfLinks).each((_, el) => {
    const a = absolute(baseUrl, $(el).attr("href"));
    if (a && /\.pdf(\?|$)/i.test(a)) out.add(a);
  });
  return [...out];
}
