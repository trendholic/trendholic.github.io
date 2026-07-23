// ============================================================================
// adapters/base.js — the reusable extraction engine. A concrete adapter is just
// a set of CSS SELECTORS (+ optional overrides) passed to createAdapter().
// Strategy per field: schema.org JSON-LD → OpenGraph/meta → CSS selectors.
// Only the per-site selector file needs to change if the supplier updates HTML.
// ============================================================================
import { absolute, cleanText } from "../util.js";

const textOf = ($, sel) => (sel ? cleanText($(sel).first().text()) : "");

export function createAdapter(SELECTORS, overrides = {}) {
  const api = {
    selectors: SELECTORS,

    discoverCategories($, baseUrl) {
      const out = new Map();
      $(SELECTORS.categoryLinks).each((_, el) => {
        const href = $(el).attr("href"); if (!href) return;
        const url = absolute(baseUrl, href);
        if (!url || !url.startsWith(baseUrl)) return;
        const name = cleanText($(el).text());
        if (name && !out.has(url)) out.set(url, { name, url });
      });
      return [...out.values()];
    },

    parseCategory($, pageUrl, baseUrl) {
      const productUrls = [];
      $(SELECTORS.productLinks).each((_, el) => {
        const url = absolute(baseUrl, $(el).attr("href"));
        if (url && url.startsWith(baseUrl)) productUrls.push(url);
      });
      const nextHref = $(SELECTORS.nextPage).first().attr("href");
      return {
        productUrls: [...new Set(productUrls)],
        nextPage: nextHref ? absolute(baseUrl, nextHref) : null,
        title: cleanText($(SELECTORS.categoryTitle).first().text()),
      };
    },

    parseProduct($, url, baseUrl) {
      const ld = readJsonLdProduct($);
      return {
        sourceUrl: url,
        name: ld.name || textOf($, SELECTORS.name) || $("meta[property='og:title']").attr("content") || "",
        sku: ld.sku || textOf($, SELECTORS.sku) || "",
        brand: ld.brand || textOf($, SELECTORS.brand) || "",
        modelNumber: ld.mpn || textOf($, SELECTORS.modelNumber) || "",
        description: ld.description || textOf($, SELECTORS.description)
          || $("meta[property='og:description']").attr("content")
          || $("meta[name='description']").attr("content") || "",
        specifications: extractSpecs($, SELECTORS),
        features: extractList($, SELECTORS.features),
        technicalData: textOf($, SELECTORS.technicalData) || "",
        variations: extractList($, SELECTORS.variations),
        images: extractImages($, baseUrl, ld, SELECTORS),
        pdfs: extractPdfs($, baseUrl, SELECTORS),
      };
    },
  };
  return { ...api, ...overrides };
}

// ---- shared helpers --------------------------------------------------------
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

function extractSpecs($, S) {
  const rows = [];
  $(S.specsTable).find("tr").each((_, tr) => {
    const c = $(tr).find("th,td");
    if (c.length >= 2) { const k = cleanText($(c[0]).text()); const v = cleanText($(c[1]).text()); if (k) rows.push(`${k}: ${v}`); }
  });
  return rows.join("\n");
}
function extractList($, sel) {
  const out = [];
  $(sel).each((_, el) => { const t = cleanText($(el).attr("value") || $(el).text()); if (t) out.push(t); });
  return out;
}
function extractImages($, baseUrl, ld, S) {
  const urls = new Set();
  (ld.image || []).forEach((u) => { const a = absolute(baseUrl, u); if (a) urls.add(a); });
  $(S.images).each((_, el) => {
    const raw = $(el).attr("data-zoom-image") || $(el).attr("data-large") ||
                $(el).attr("data-src") || $(el).attr("src") || $(el).attr("content");
    const a = absolute(baseUrl, raw);
    if (a && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(a)) urls.add(a);
  });
  return [...urls];
}
function extractPdfs($, baseUrl, S) {
  const out = new Set();
  $(S.pdfLinks).each((_, el) => { const a = absolute(baseUrl, $(el).attr("href")); if (a && /\.pdf(\?|$)/i.test(a)) out.add(a); });
  return [...out];
}
