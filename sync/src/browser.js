// ============================================================================
// browser.js — headless Chromium with realistic behavior + session persistence.
// Handles JS-rendered / Cloudflare-fronted pages. Playwright is an OPTIONAL
// dependency: if it isn't installed, rendering is disabled and the crawler
// falls back to plain HTTP (server-rendered pages still work).
//
// Lawful use only: this reuses a saved session and can log in with credentials
// supplied via ENV. It does NOT attempt to defeat authentication or security.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import log from "./logger.js";
import { sleep } from "./http.js";

let browser = null;
let context = null;
let unavailable = false;
let loggedIn = false;

function loadStorageState() {
  try { return JSON.parse(fs.readFileSync(CONFIG.browser.sessionFile, "utf8")); }
  catch { return undefined; }
}
function saveStorageState(state) {
  try {
    fs.mkdirSync(path.dirname(CONFIG.browser.sessionFile), { recursive: true });
    fs.writeFileSync(CONFIG.browser.sessionFile, JSON.stringify(state));
  } catch (e) { log.warn(`session not saved: ${e.message}`); }
}

async function getContext() {
  if (unavailable) return null;
  if (context) return context;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    context = await browser.newContext({
      userAgent: CONFIG.source.userAgent,
      locale: CONFIG.browser.locale,
      viewport: CONFIG.browser.viewport,
      storageState: loadStorageState(),        // resume prior session/cookies
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    // mask the most obvious automation signal
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    return context;
  } catch (e) {
    unavailable = true;
    log.warn(`Playwright unavailable (${e.message}); JS rendering disabled.`);
    return null;
  }
}

// Optional login using ENV credentials. Runs once per process, then the session
// is persisted so subsequent runs skip it.
async function ensureLogin(ctx) {
  if (loggedIn || !CONFIG.login.url || !CONFIG.login.username) return;
  const page = await ctx.newPage();
  try {
    await page.goto(CONFIG.login.url, { waitUntil: "domcontentloaded", timeout: CONFIG.crawl.timeoutMs });
    await page.fill(CONFIG.login.userSelector, CONFIG.login.username);
    await page.fill(CONFIG.login.passSelector, CONFIG.login.password);
    await Promise.allSettled([
      page.click(CONFIG.login.submitSelector),
      page.waitForLoadState("networkidle", { timeout: CONFIG.crawl.timeoutMs }),
    ]);
    if (CONFIG.login.successSelector) {
      await page.waitForSelector(CONFIG.login.successSelector, { timeout: 10000 }).catch(() => {});
    }
    saveStorageState(await ctx.storageState());
    loggedIn = true;
    log.info("Supplier login completed; session persisted.");
  } catch (e) {
    log.warn(`login failed (continuing unauthenticated): ${e.message}`);
  } finally { await page.close().catch(() => {}); }
}

// Render a URL and return its HTML after network settles.
export async function renderHtml(urlStr) {
  const ctx = await getContext();
  if (!ctx) return null;
  await ensureLogin(ctx);
  const page = await ctx.newPage();
  try {
    if (CONFIG.browser.humanJitterMs) await sleep(Math.random() * CONFIG.browser.humanJitterMs);
    await page.goto(urlStr, { waitUntil: "networkidle", timeout: CONFIG.crawl.timeoutMs });
    // Cloudflare interstitials resolve themselves; give them a beat.
    const html = await page.content();
    if (looksBlocked(html)) { await sleep(4000); return await page.content(); }
    return html;
  } finally { await page.close().catch(() => {}); }
}

export async function closeBrowser() {
  try { if (context) saveStorageState(await context.storageState()); } catch { /* noop */ }
  if (browser) { await browser.close().catch(() => {}); browser = null; context = null; }
}

// Heuristic: does this HTML look empty / blocked and warrant a render pass?
export function looksBlocked(html) {
  if (!html || html.length < 800) return true;
  return /just a moment|cf-browser-verification|enable javascript|__cf_chl|attention required/i.test(html);
}
