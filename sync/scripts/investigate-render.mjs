// ============================================================================
// investigate-render.mjs — READ-ONLY investigation: does JavaScript/browser
// rendering expose supplier category products that plain HTTP fetch misses?
//
// For a SMALL, representative set of category URLs across all 4 supplier
// domains it compares:
//   • raw HTTP product count (cheerio over the served HTML)
//   • JS-rendered DOM product count (Playwright, after networkidle + scroll)
//   • product URLs discovered
//   • pagination / infinite-scroll behavior
//   • every network request the browser made (to reveal XHR/fetch/API endpoints)
//
// STRICTLY read-only: it navigates and observes. It never logs in, submits a
// form, clicks a buy/inquiry control, or writes to the supplier. It writes a
// report to sync/investigation/ and prints a summary. Intended to run on the
// GitHub Actions runner (direct internet), NOT in the proxied dev sandbox.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import CONFIG from "../config.js";
import { getAdapter } from "../src/adapters/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "investigation");
fs.mkdirSync(OUT_DIR, { recursive: true });

const CATS_PER_DOMAIN = parseInt(process.env.INVESTIGATE_CATS_PER_DOMAIN || "3", 10);
const NAV_TIMEOUT = 45000;
const PROD_RE = /productinfoen_\d+\.html/gi;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (a) => [...new Set(a)];

async function httpGet(url) {
  const res = await fetch(url, { headers: { "user-agent": CONFIG.source.userAgent }, redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, html: buf.toString("utf8") };
}
const countProducts = (html) => uniq((html.match(PROD_RE) || []).map((s) => s.toLowerCase()));

async function robotsNote(base) {
  try { const r = await fetch(base + "/robots.txt"); return `robots.txt HTTP ${r.status}`; }
  catch (e) { return `robots.txt error ${e.message}`; }
}

async function main() {
  const { chromium } = await import("playwright").catch(() => import("playwright-core"));
  const report = { startedAt: new Date().toISOString(), domains: [], summary: {} };
  const browser = await chromium.launch();

  for (const src of CONFIG.sources) {
    const base = src.baseUrl.replace(/\/$/, "");
    const { adapter } = getAdapter(base);
    const dom = { source: src.key, top: src.top, base, robots: await robotsNote(base), categories: [], notes: [] };

    // discover categories from the homepage (HTTP)
    let cats = [];
    try {
      const home = await httpGet(base + "/");
      cats = adapter.discoverCategories(cheerio.load(home.html), base).slice(0, CATS_PER_DOMAIN);
    } catch (e) { dom.notes.push(`homepage/category discovery failed: ${e.message}`); }

    for (const c of cats) {
      const entry = { name: c.name, url: c.url, http: {}, rendered: {}, xhr: [], pagination: [], infiniteScroll: false };
      // ---- raw HTTP ----
      try { const r = await httpGet(c.url); entry.http = { status: r.status, products: countProducts(r.html).length, bytes: r.html.length }; }
      catch (e) { entry.http = { error: e.message }; }

      // ---- JS render ----
      const ctx = await browser.newContext({ userAgent: CONFIG.source.userAgent, viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      const requests = [];
      page.on("request", (req) => requests.push({ method: req.method(), url: req.url(), type: req.resourceType() }));
      try {
        await page.goto(c.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
        await sleep(1500);
        const before = countProducts(await page.content()).length;
        // scroll to trigger lazy-load / infinite scroll
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 20000); await sleep(1200); }
        const html = await page.content();
        const after = countProducts(html).length;
        entry.rendered = { products: after, productsBeforeScroll: before, bytes: html.length };
        entry.infiniteScroll = after > before;
        // pagination links present in rendered DOM
        entry.pagination = uniq((html.match(/(?:categoryen_\d+_\d+\.html|[?&](?:page|p|pageindex)=\d+)/gi) || [])).slice(0, 8);
        entry.sampleProducts = uniq((html.match(PROD_RE) || [])).slice(0, 3);
      } catch (e) { entry.rendered = { error: e.message }; }
      // XHR/fetch/api endpoints the browser called (exclude static asset noise)
      entry.xhr = uniq(requests.filter((r) => /xhr|fetch/i.test(r.type) || /\.(ashx|asmx|json|api)|\/api\//i.test(r.url)).map((r) => `${r.method} ${r.url}`)).slice(0, 25);
      await ctx.close();
      dom.categories.push(entry);
    }
    report.domains.push(dom);
  }

  await browser.close();

  // ---- aggregate ----
  let httpTot = 0, renderTot = 0, gained = 0, anyInfinite = false;
  const apis = new Set();
  for (const d of report.domains) for (const c of d.categories) {
    const h = c.http.products || 0, r = c.rendered.products || 0;
    httpTot += h; renderTot += r; gained += Math.max(0, r - h);
    if (c.infiniteScroll) anyInfinite = true;
    c.xhr.forEach((x) => { if (/\.(ashx|asmx|json)|\/api\//i.test(x)) apis.add(x.replace(/[?].*$/, "")); });
  }
  report.summary = {
    categoriesTested: report.domains.reduce((n, d) => n + d.categories.length, 0),
    httpProductsTotal: httpTot, renderedProductsTotal: renderTot, productsGainedByRendering: gained,
    infiniteScrollObserved: anyInfinite, apiEndpointsObserved: [...apis],
    verdict: gained > 0 ? "JS RENDERING EXPOSES ADDITIONAL PRODUCTS" : "JS RENDERING EXPOSES NO ADDITIONAL PRODUCTS",
  };

  fs.writeFileSync(path.join(OUT_DIR, "render-report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "render-report.md"), toMarkdown(report));
  console.log("\n=== INVESTIGATION SUMMARY ===\n" + JSON.stringify(report.summary, null, 2));
}

function toMarkdown(r) {
  const L = [`# JS-Render Category Investigation (read-only)`, ``, `Started: ${r.startedAt}`, ``,
    `## Summary`, ``,
    `- Categories tested: **${r.summary.categoriesTested}**`,
    `- HTTP product links total: **${r.summary.httpProductsTotal}**`,
    `- JS-rendered product links total: **${r.summary.renderedProductsTotal}**`,
    `- Products gained by rendering: **${r.summary.productsGainedByRendering}**`,
    `- Infinite scroll observed: **${r.summary.infiniteScrollObserved}**`,
    `- API endpoints observed: ${r.summary.apiEndpointsObserved.length ? r.summary.apiEndpointsObserved.map((x) => `\`${x}\``).join(", ") : "none"}`,
    ``, `**Verdict: ${r.summary.verdict}**`, ``, `## Per-domain detail`, ``];
  for (const d of r.domains) {
    L.push(`### ${d.top} — ${d.base}`, `- ${d.robots}`);
    if (d.notes.length) L.push(...d.notes.map((n) => `- note: ${n}`));
    L.push(``, `| Category | HTTP products | Rendered products | Infinite scroll | XHR/API seen |`, `|---|---|---|---|---|`);
    for (const c of d.categories) {
      L.push(`| ${c.name} | ${c.http.products ?? c.http.error ?? "?"} | ${c.rendered.products ?? c.rendered.error ?? "?"} | ${c.infiniteScroll} | ${c.xhr.length} |`);
    }
    L.push(``);
    for (const c of d.categories) if (c.xhr.length) L.push(`- **${c.name}** XHR/API: ${c.xhr.slice(0, 8).map((x) => `\`${x}\``).join(" · ")}`);
    L.push(``);
  }
  return L.join("\n");
}

main().catch((e) => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
