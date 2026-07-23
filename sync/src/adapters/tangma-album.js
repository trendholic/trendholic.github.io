// ============================================================================
// tangma-album.js — shared extraction for the tangma2088 "album" platform.
// CALIBRATED against the live Apparel site (tangma2088.com, English variant),
// 2026-07-23. The accessories/bags/shoes subdomains run the SAME IIS/ASP.NET
// "Fashion Album" platform, so they reuse this logic — but they are marked
// `verified:false` in their adapter files until a reachable crawl confirms it.
// ============================================================================
import { absolute, cleanText } from "../util.js";

// hrefs are relative (e.g. "productinfoen_5715909.html") — no leading slash.
const PRODUCT_RE = /productinfoen_(\d+)\.html/i;
const CATEGORY_RE = /categoryen_\d+\.html/i;

const stripSuffix = (t) =>
  cleanText(String(t || "").replace(/-\s*(Fashion Album|服饰相册|相册)\s*$/i, ""));

export function createTangmaAlbumAdapter(source) {
  return {
    source, // { key, top }

    discoverCategories($, baseUrl) {
      const out = new Map();
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href"); if (!href || !CATEGORY_RE.test(href)) return;
        const url = absolute(baseUrl, href); if (!url) return;
        const name = cleanText($(el).text());
        const path = (/path=([\w_]+)/i.exec(url) || [])[1] || "";
        if (name && !out.has(url)) out.set(url, { name, url, sourcePath: path });
      });
      return [...out.values()];
    },

    parseCategory($, pageUrl, baseUrl) {
      const productUrls = new Set();
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (href && PRODUCT_RE.test(href)) { const u = absolute(baseUrl, href); if (u) productUrls.add(u); }
      });
      let nextPage = null;
      $("a[href]").each((_, el) => {
        const t = cleanText($(el).text());
        if (/^(>|»|下一页|next)$/i.test(t)) { const u = absolute(baseUrl, $(el).attr("href")); if (u) nextPage = u; }
      });
      return { productUrls: [...productUrls], nextPage, title: stripSuffix($("title").text()) };
    },

    parseProduct($, url, baseUrl) {
      const id = (PRODUCT_RE.exec(url) || [])[1] || "";
      const name = stripSuffix($("title").text()) || cleanText($("h1").first().text());
      const images = new Set();
      $("img[src]").each((_, el) => {
        const src = $(el).attr("src") || "";
        if (/\/upfile\/product\//i.test(src)) {
          const abs = absolute(baseUrl, encodeURI(src)); // encode spaces/parens
          if (abs) images.add(abs);
        }
      });
      const description = cleanText($("#content, .content, .product-desc, .description").first().text());
      return {
        sourceUrl: url,
        sourceProductId: id,
        name,
        sku: "", brand: "", modelNumber: "",   // preserved inside name; not separately exposed → not invented
        description, specifications: "", features: [], technicalData: "",
        variations: [], images: [...images], pdfs: [],
      };
    },
  };
}
