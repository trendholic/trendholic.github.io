// End-to-end cart + WhatsApp checkout test against the generated static pages.
// Drives the pre-installed Chromium over file:// URLs. No network required.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const REPO = path.resolve(process.cwd(), "..");
const EXE = fs.readdirSync("/opt/pw-browsers").map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const prodDir = path.join(REPO, "catalog", "product");
const slugs = fs.readdirSync(prodDir).slice(0, 2);

// Minimal static server rooted at the repo so absolute /catalog/... paths resolve
// exactly as they do on GitHub Pages (directory URLs serve index.html).
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".xml": "application/xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(REPO, p);
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, "index.html"); } catch {}
  fs.readFile(f, (e, data) => {
    if (e) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const url = (s) => `${ORIGIN}/catalog/product/${s}/`;
const landing = `${ORIGIN}/catalog/`;

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("  ok:", m); };

const b = await chromium.launch({ executablePath: EXE });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
let waURL = null;
await ctx.exposeFunction("__capWA", (u) => { waURL = u; });

async function stubOpen() { await page.evaluate(() => { window.open = (u) => { window.__capWA(u); return null; }; }); }

console.log("== Product page 1:", slugs[0]);
await page.goto(url(slugs[0]));
await stubOpen();
const name1 = await page.getAttribute(".add-cart", "data-name");
const ref1 = await page.getAttribute(".add-cart", "data-ref");
await page.click(".buy .q-inc"); await page.click(".buy .q-inc"); // qty 3
assert((await page.inputValue(".buy .q-in")) === "3", "buy qty stepper -> 3");
await page.click(".add-cart");
await page.waitForSelector("#cart-drawer:not([hidden])");
assert(true, "drawer opens on add");
assert((await page.textContent("#cart-count")) === "3", "cart badge = 3 after add qty 3");
assert((await page.locator(".cart-row").count()) === 1, "1 cart row");

console.log("== Product page 2:", slugs[1]);
await page.goto(url(slugs[1]));
await stubOpen();
const name2 = await page.getAttribute(".add-cart", "data-name");
await page.fill(".buy .q-in", "5");
await page.click(".add-cart");
await page.waitForSelector("#cart-drawer:not([hidden])");
assert((await page.textContent("#cart-count")) === "8", "cart badge = 8 (3+5)");
assert((await page.locator(".cart-row").count()) === 2, "2 cart rows");

console.log("== Persistence across reload");
await page.reload();
await stubOpen();
assert((await page.textContent("#cart-count")) === "8", "cart persists after reload (badge 8)");

console.log("== Change qty in cart drawer");
await page.click("#cart-btn");
await page.waitForSelector("#cart-drawer:not([hidden])");
await page.locator(".cart-row .q-dec").first().click(); // 3 -> 2 on first row
assert((await page.textContent("#cart-total-items")) === "7", "total items 7 after decrement");

console.log("== Fill details + checkout");
await page.click(".cart-form summary");
await page.fill("#cf-name", "Jane Buyer");
await page.fill("#cf-company", "Acme Wholesale");
await page.fill("#cf-phone", "+1 555 0100");
await page.fill("#cf-address", "12 Market St, NY");
await page.click("#cart-checkout");
await page.waitForTimeout(200);
assert(!!waURL, "checkout generated a WhatsApp URL");
assert(/^https:\/\/wa\.me\/13313049903\?text=/.test(waURL || ""), "URL targets wa.me/13313049903");
const msg = decodeURIComponent((waURL || "").split("?text=")[1] || "");
console.log("\n----- GENERATED WHATSAPP MESSAGE -----\n" + msg + "\n--------------------------------------");
assert(/^Hello TrendHolic, I would like to place a wholesale order:/.test(msg), "message greeting correct");
assert(msg.includes("Total Items: 7"), "message Total Items: 7");
assert(msg.includes("Quantity: 2") && msg.includes("Quantity: 5"), "message includes both quantities");
assert(msg.includes("Customer Name: Jane Buyer"), "message includes customer name");
assert(msg.includes("Company: Acme Wholesale"), "message includes company");
assert(msg.includes("Please confirm availability and final wholesale pricing."), "message confirmation line");
assert(!/Price:/.test(msg), "no fabricated Price line (supplier has none)");

console.log("== Mobile viewport");
const m = await b.newContext({ viewport: { width: 375, height: 720 }, isMobile: true });
const mp = await m.newPage();
await mp.goto(url(slugs[0]));
await mp.click(".add-cart");
await mp.waitForSelector("#cart-drawer:not([hidden])");
const panelW = await mp.evaluate(() => document.querySelector(".cart-panel").getBoundingClientRect().width);
assert(panelW <= 375 && panelW > 200, "cart panel fits mobile width (" + Math.round(panelW) + "px)");
const waBtnVisible = await mp.isVisible("#cart-checkout");
assert(waBtnVisible, "WhatsApp button visible on mobile");

await b.close();
server.close();
console.log(process.exitCode ? "\nTEST RESULT: FAILURES ABOVE" : "\nTEST RESULT: ALL CART TESTS PASSED");
