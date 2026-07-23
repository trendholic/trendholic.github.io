// images.js — download supplier images, compress to web-optimized WebP with
// SEO-friendly filenames, and (optionally) keep a high-res original. PDFs too.
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import log from "./logger.js";
import { fetchBuffer } from "./http.js";
import { slugify } from "./util.js";

let sharpLib = null;
async function sharp() {
  if (sharpLib === false) return null;
  if (sharpLib) return sharpLib;
  try { sharpLib = (await import("sharp")).default; }
  catch (e) { sharpLib = false; log.warn(`sharp unavailable (${e.message}); images copied without compression.`); }
  return sharpLib || null;
}

const rel = (abs) => "/" + path.relative(CONFIG.out.repoRoot, abs).split(path.sep).join("/");

// Download + process all images for a product. Returns image metadata array.
export async function processImages(product, categorySlug, productSlug) {
  const dir = path.join(CONFIG.out.imagesDir, categorySlug);
  if (!CONFIG.dryRun) fs.mkdirSync(dir, { recursive: true });
  const srcs = (product.images || []).slice(0, CONFIG.images.maxPerProduct);
  const out = [];
  let idx = 0;
  for (const url of srcs) {
    idx++;
    const seoName = `${productSlug}-${idx}`;
    try {
      if (CONFIG.dryRun) { out.push({ url, src: `${CONFIG.out.catalogPublicPath}…/${seoName}.webp`, alt: altFor(product, idx), dryRun: true }); continue; }
      const { buffer } = await fetchBuffer(url);
      const webpPath = path.join(dir, `${seoName}.webp`);
      const s = await sharp();
      let width = null, height = null;
      if (s) {
        const img = s(buffer).rotate();
        const meta = await img.metadata();
        const pipe = meta.width && meta.width > CONFIG.images.maxWidth
          ? img.resize({ width: CONFIG.images.maxWidth }) : img;
        const info = await pipe.webp({ quality: CONFIG.images.webpQuality }).toFile(webpPath);
        width = info.width; height = info.height;
        if (CONFIG.images.keepOriginalHighRes) {
          const ext = (url.split(".").pop() || "jpg").split(/\W/)[0].toLowerCase();
          fs.writeFileSync(path.join(dir, `${seoName}-original.${ext}`), buffer);
        }
      } else {
        fs.writeFileSync(webpPath, buffer); // no compression fallback
      }
      log.count.images++;
      out.push({
        url, // original source (for provenance)
        src: rel(webpPath),
        alt: altFor(product, idx),
        width, height,
      });
    } catch (e) {
      log.count.downloadFailed++;
      log.fail(`image ${url}`, e, { product: product.sku || productSlug });
      // continue with remaining images
    }
  }
  return out;
}

export async function processPdfs(product, categorySlug, productSlug) {
  const pdfs = product.pdfs || [];
  if (!pdfs.length) return [];
  const dir = path.join(CONFIG.out.pdfDir, categorySlug);
  if (!CONFIG.dryRun) fs.mkdirSync(dir, { recursive: true });
  const out = [];
  let i = 0;
  for (const url of pdfs) {
    i++;
    try {
      if (CONFIG.dryRun) { out.push({ url, src: null, dryRun: true }); continue; }
      const { buffer } = await fetchBuffer(url);
      const p = path.join(dir, `${productSlug}-manual-${i}.pdf`);
      fs.writeFileSync(p, buffer);
      out.push({ url, src: rel(p), title: `${product.name} manual ${i}` });
    } catch (e) { log.count.downloadFailed++; log.fail(`pdf ${url}`, e, { product: product.sku || productSlug }); }
  }
  return out;
}

function altFor(product, idx) {
  const parts = [product.brand, product.name].filter(Boolean).join(" ");
  return `${parts}${idx > 1 ? ` — view ${idx}` : ""}`.trim() || `product image ${idx}`;
}
