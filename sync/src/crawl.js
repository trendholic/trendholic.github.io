// crawl.js — site-agnostic crawling built on http.js + browser.js + adapter.js.
import * as cheerio from "cheerio";
import CONFIG from "../config.js";
import log from "./logger.js";
import { fetchHtml } from "./http.js";
import { renderHtml, looksBlocked } from "./browser.js";
import { getAdapter } from "./adapters/index.js";

const BASE = CONFIG.source.baseUrl.replace(/\/$/, "");
const { adapter, id: adapterId } = getAdapter(CONFIG.source.baseUrl);
export { adapterId };

// Load HTML, using a headless browser when needed (JS render / anti-bot).
async function loadHtml(url) {
  let html = null;
  if (CONFIG.source.render !== "always") {
    try { html = await fetchHtml(url); } catch (e) { if (e.robots) throw e; log.warn(`plain fetch failed ${url}: ${e.message}`); }
  }
  const needRender = CONFIG.source.render === "always" ||
    (CONFIG.source.render === "auto" && looksBlocked(html));
  if (needRender) {
    const rendered = await renderHtml(url);
    if (rendered) html = rendered;
  }
  if (!html) throw new Error("no HTML retrieved");
  return cheerio.load(html);
}

export async function getCategories() {
  if (CONFIG.source.seedCategories.length) {
    return CONFIG.source.seedCategories.map((url) => ({ name: deriveName(url), url }));
  }
  log.step("Discovering categories from homepage");
  const $ = await loadHtml(BASE + "/");
  const cats = adapter.discoverCategories($, BASE);
  log.info(`Discovered ${cats.length} category link(s).`);
  return cats;
}

export async function getProductUrls(category) {
  const urls = new Set();
  let pageUrl = category.url;
  let pages = 0;
  while (pageUrl && pages < CONFIG.crawl.maxPagesPerCategory) {
    pages++;
    const $ = await loadHtml(pageUrl);
    const { productUrls, nextPage, title } = adapter.parseCategory($, pageUrl, BASE);
    if (title && !category.name) category.name = title;
    productUrls.forEach((u) => urls.add(u));
    if (CONFIG.crawl.maxProductsPerCategory && urls.size >= CONFIG.crawl.maxProductsPerCategory) break;
    if (!nextPage || nextPage === pageUrl) break;
    pageUrl = nextPage;
  }
  let list = [...urls];
  if (CONFIG.crawl.maxProductsPerCategory) list = list.slice(0, CONFIG.crawl.maxProductsPerCategory);
  return list;
}

export async function fetchProduct(url) {
  const $ = await loadHtml(url);
  const p = adapter.parseProduct($, url, BASE);
  if (!p.name) throw new Error("no product name extracted (adapter selectors may need calibration)");
  return p;
}

function deriveName(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() || "category";
    return seg.replace(/[-_]+/g, " ").replace(/\.\w+$/, "").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch { return "Category"; }
}
