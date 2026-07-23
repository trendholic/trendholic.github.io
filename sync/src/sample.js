// ============================================================================
// sample.js — CONTROLLED sample crawl of ONE source (default 2 products).
// Proves the adapter against the real site before full synchronization.
// Usage: SAMPLE_SOURCE=apparel SAMPLE_LIMIT=2 node src/sample.js
// Writes real artifacts under data/<top>/ and prints a truthful report.
// Aborts safely (no writes) if robots/access is not permitted.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import CONFIG from "../config.js";
import { fetchHtml, fetchBuffer, robotsAllows, robotsStatus } from "./http.js";
import { getAdapter } from "./adapters/index.js";
import { slugify } from "./util.js";

const SRC_KEY = process.env.SAMPLE_SOURCE || "apparel";
const LIMIT = parseInt(process.env.SAMPLE_LIMIT || "2", 10);
const src = CONFIG.sources.find((s) => s.key === SRC_KEY);
if (!src) { console.error("unknown source", SRC_KEY); process.exit(2); }
const BASE = src.baseUrl.replace(/\/$/, "");
const { adapter, id: adapterId, verified, top } = getAdapter(BASE);
const host = new URL(BASE).host;
const topSlug = slugify(top);

const report = { source: SRC_KEY, top, adapter: adapterId, verified, host,
  categoriesSeen: 0, productsFound: 0, productsWritten: 0, imagesDownloaded: 0, imageFailures: 0,
  products: [], failures: [], flags: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sharpLib = null;
async function sharp() { if (sharpLib === false) return null; if (sharpLib) return sharpLib;
  try { sharpLib = (await import("sharp")).default; } catch { sharpLib = false; } return sharpLib || null; }

async function main() {
  console.log(`SAMPLE crawl: source=${SRC_KEY} top=${top} adapter=${adapterId} verified=${verified} base=${BASE}`);

  // ---- preflight: authorized access ----
  if (CONFIG.source.respectRobots && !(await robotsAllows(BASE + "/"))) {
    console.error(`BLOCKED: ${await robotsStatus(BASE + "/")} — no crawl performed.`);
    process.exit(3);
  }

  // domain → expected top-category guard (flag, never silently misassign)
  const expectedTop = CONFIG.domainToTop[host];
  if (expectedTop && expectedTop !== top) report.flags.push(`domain ${host} expected top '${expectedTop}' but adapter says '${top}'`);

  // ---- discover categories ----
  const $home = cheerio.load(await fetchHtml(BASE + "/"));
  let cats = adapter.discoverCategories($home, BASE);
  report.categoriesSeen = cats.length;
  console.log(`categories discovered: ${cats.length}`);

  // ---- find a category that lists products (else fall back to new-products) ----
  let productUrls = [], usedCat = null;
  for (const c of cats.slice(0, 6)) {
    try {
      const $c = cheerio.load(await fetchHtml(c.url));
      const { productUrls: pu } = adapter.parseCategory($c, c.url, BASE);
      if (pu.length) { productUrls = pu.slice(0, LIMIT); usedCat = c; break; }
    } catch (e) { report.failures.push(`category ${c.url}: ${e.message}`); }
    await sleep(CONFIG.crawl.minDelayMs);
  }
  if (!productUrls.length) {
    const npUrl = BASE + "/newproductsen_0.html";
    try {
      const $np = cheerio.load(await fetchHtml(npUrl));
      const { productUrls: pu } = adapter.parseCategory($np, npUrl, BASE);
      productUrls = pu.slice(0, LIMIT);
      usedCat = { name: "New Products", url: npUrl, sourcePath: "new" };
    } catch (e) { report.failures.push(`new-products ${npUrl}: ${e.message}`); }
  }
  report.productsFound = productUrls.length;
  console.log(`sample category: ${usedCat?.name || "?"} | products to fetch: ${productUrls.length}`);

  // ---- fetch + persist each product ----
  const outProducts = path.join(CONFIG.out.dataDir, topSlug, "products");
  const outImages = path.join(CONFIG.out.dataDir, topSlug, "images");
  fs.mkdirSync(outProducts, { recursive: true });
  fs.mkdirSync(outImages, { recursive: true });

  for (const url of productUrls) {
    try {
      const $p = cheerio.load(await fetchHtml(url));
      const raw = adapter.parseProduct($p, url, BASE);
      const slug = (slugify(raw.name, 60) + "-" + (raw.sourceProductId || "")).replace(/-+$/, "") || slugify(raw.name);

      const images = [];
      let n = 0;
      for (const imgUrl of raw.images.slice(0, CONFIG.images.maxPerProduct)) {
        n++;
        try {
          const { buffer } = await fetchBuffer(imgUrl);
          const s = await sharp();
          let file, width = null, height = null;
          if (s) {
            file = path.join(outImages, `${slug}-${n}.webp`);
            const info = await s(buffer).rotate().resize({ width: CONFIG.images.maxWidth, withoutEnlargement: true })
              .webp({ quality: CONFIG.images.webpQuality }).toFile(file);
            width = info.width; height = info.height;
          } else {
            const ext = (imgUrl.split(".").pop() || "jpg").split(/[?#]/)[0].slice(0, 4);
            file = path.join(outImages, `${slug}-${n}.${ext}`);
            fs.writeFileSync(file, buffer);
          }
          report.imagesDownloaded++;
          images.push({ src: "/" + path.relative(CONFIG.out.repoRoot, file).split(path.sep).join("/"),
                        source_url: imgUrl, alt: raw.name, width, height });
        } catch (e) { report.imageFailures++; report.failures.push(`image ${imgUrl}: ${e.message}`); }
      }

      const record = {
        // identity + provenance (permanent)
        slug,
        top_category: top,
        source_site: SRC_KEY,
        source_domain: host,
        source_category: usedCat?.name || null,
        source_category_original: usedCat?.sourcePath || null,
        source_product_url: url,
        source_product_id: raw.sourceProductId || null,
        source_sku: raw.sku || null,
        source_model_number: raw.modelNumber || null,
        // customer-facing (English variant already)
        name: raw.name,
        english_product_name: raw.name,
        original_product_name: null,   // Chinese variant not fetched in the English sample
        brand: raw.brand || null,
        sku: raw.sku || null,
        model_number: raw.modelNumber || null,
        product_code: null, product_id: raw.sourceProductId || null,
        description: raw.description || null,
        features: raw.features || [],
        specifications: raw.specifications || null,
        materials: null, color: null, size: null, variants: [],
        dimensions: null, weight: null, packaging: null, moq: null,
        price: null, currency: null, availability: null,
        images, pdfs: raw.pdfs || [],
        synced_at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(outProducts, `${slug}.json`), JSON.stringify(record, null, 2));
      report.productsWritten++;
      report.products.push({ slug, name: raw.name, id: raw.sourceProductId, images: images.length });
      console.log(`  ✓ ${slug} — "${raw.name}" (${images.length} imgs)`);
    } catch (e) { report.failures.push(`product ${url}: ${e.message}`); console.log(`  ✗ ${url}: ${e.message}`); }
    await sleep(CONFIG.crawl.minDelayMs);
  }

  fs.mkdirSync(path.join(CONFIG.out.dataDir, topSlug), { recursive: true });
  fs.writeFileSync(path.join(CONFIG.out.dataDir, topSlug, "_sample-report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== SAMPLE REPORT ===\n" + JSON.stringify({ ...report, products: report.products, failures: report.failures }, null, 2));
}

main().catch((e) => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
