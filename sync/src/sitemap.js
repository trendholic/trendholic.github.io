// sitemap.js — generate /sitemap.xml for the catalog (additive; does not touch
// existing retail pages, but includes the site root so search engines see both).
import fs from "node:fs";
import CONFIG from "../config.js";
import { slugify } from "./util.js";

export function writeSitemap(catalog) {
  if (CONFIG.dryRun) return;
  const base = CONFIG.out.siteBaseUrl.replace(/\/$/, "");
  const cp = CONFIG.out.catalogPublicPath.replace(/\/$/, "");
  const now = new Date().toISOString().slice(0, 10);
  const urls = [];

  const push = (loc, prio) => urls.push(
    `  <url><loc>${xml(loc)}</loc><lastmod>${now}</lastmod><priority>${prio}</priority></url>`
  );

  push(`${base}/`, "1.0");                 // retail home (unchanged page)
  push(`${base}${cp}/`, "0.9");            // catalog index

  for (const [slug, { products }] of Object.entries(catalog)) {
    push(`${base}${cp}/${slug}/`, "0.8");
    for (const p of products) push(`${base}${cp}/${slug}/${p.slug}.html`, "0.7");
  }

  const doc =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") + `\n</urlset>\n`;
  fs.writeFileSync(CONFIG.out.sitemap, doc);
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
export { slugify };
