// browser.js — OPTIONAL headless rendering for JS-heavy / anti-bot pages.
// Playwright is an optional dependency; if it isn't installed we degrade to
// plain HTTP (the crawler still works for server-rendered pages).
import CONFIG from "../config.js";
import log from "./logger.js";

let browser = null;
let unavailable = false;

async function getBrowser() {
  if (unavailable) return null;
  if (browser) return browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    return browser;
  } catch (e) {
    unavailable = true;
    log.warn(`Playwright unavailable (${e.message}); JS rendering disabled.`);
    return null;
  }
}

// Render a URL and return its HTML after network settles.
export async function renderHtml(urlStr) {
  const b = await getBrowser();
  if (!b) return null;
  const ctx = await b.newContext({ userAgent: CONFIG.source.userAgent, locale: "en-US" });
  const page = await ctx.newPage();
  try {
    await page.goto(urlStr, { waitUntil: "networkidle", timeout: CONFIG.crawl.timeoutMs });
    return await page.content();
  } finally { await ctx.close().catch(() => {}); }
}

export async function closeBrowser() {
  if (browser) { await browser.close().catch(() => {}); browser = null; }
}

// Heuristic: does this HTML look empty / blocked and warrant a render pass?
export function looksBlocked(html) {
  if (!html || html.length < 800) return true;
  return /just a moment|cf-browser-verification|enable javascript|__cf_chl/i.test(html);
}
