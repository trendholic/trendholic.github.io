// ============================================================================
// build-catalog.js — assemble the unified TrendHolic catalog from the 4 sources
// AND emit static HTML pages so clean URLs resolve on GitHub Pages:
//   /catalog/                      landing (4 categories + grid + search)
//   /catalog/<top>/                category listing
//   /catalog/product/<slug>/       product detail (+ JSON-LD, canonical, OG)
// Plus data/catalog/*, data/search-index.json, sitemap.xml, robots.txt.
// Canonical URLs are always TrendHolic; supplier URLs are never canonical and
// supplier images are never hotlinked (all images are local /data paths).
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import { slugify, truncate } from "./util.js";

const dataDir = CONFIG.out.dataDir;
const repo = CONFIG.out.repoRoot;
const base = CONFIG.out.siteBaseUrl.replace(/\/$/, "");
const cp = CONFIG.out.catalogPublicPath.replace(/\/$/, ""); // "/catalog"
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2)); };
const writeFile = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const na = (v) => (v == null || v === "" || (Array.isArray(v) && !v.length)) ? '<span class="na">Not provided</span>' : esc(Array.isArray(v) ? v.join(", ") : v);

// Single centralized WhatsApp destination for the wholesale catalog order flow.
// This is the SAME number used by the retail homepage/store-finder/cart checkout.
// Do not duplicate a different number anywhere else.
const WHATSAPP_NUMBER = "13313049903";

// Cart drawer markup + header button — injected on every catalog page so the
// cart persists across navigation. The cart state itself lives in localStorage
// (see catalog-cart.js); this is purely the UI shell.
const CART_DRAWER = `<div id="cart-drawer" class="cart-drawer" hidden>
  <div class="cart-backdrop" data-cart-close></div>
  <aside class="cart-panel" role="dialog" aria-modal="true" aria-label="Your order">
    <header class="cart-hd"><h2>Your Order</h2><button type="button" class="cart-x" data-cart-close aria-label="Close">✕</button></header>
    <div id="cart-items" class="cart-items"></div>
    <details class="cart-form"><summary>Your details (optional)</summary>
      <input id="cf-name" placeholder="Your name" autocomplete="name">
      <input id="cf-company" placeholder="Company" autocomplete="organization">
      <input id="cf-phone" placeholder="Phone" autocomplete="tel" inputmode="tel">
      <textarea id="cf-address" placeholder="Shipping address" autocomplete="street-address" rows="2"></textarea>
    </details>
    <footer class="cart-ft">
      <div class="cart-sum">Total items: <b id="cart-total-items">0</b></div>
      <button id="cart-checkout" type="button" class="wa-btn" disabled>Send Order via WhatsApp</button>
      <button id="cart-clear" type="button" class="cart-clear">Clear cart</button>
      <p class="cart-note">Final wholesale pricing is confirmed on WhatsApp.</p>
    </footer>
  </aside>
</div>`;

function page({ title, desc, canonical, ogImage, body, jsonld }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<link rel="stylesheet" href="/catalog/catalog.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
</head><body>
<header class="cat-hd">
  <a class="brand" href="/catalog/"><b>TREND</b>HOLIC · Catalog</a>
  <input id="q" placeholder="Search name, brand, model…" autocomplete="off">
  <button type="button" id="cart-btn" class="cart-open" aria-label="Open cart">🛒<span id="cart-count" class="cart-count" hidden>0</span></button>
  <a class="store" href="/index.html">← Store</a>
</header>
<main class="cat-main">${body}</main>
<footer class="cat-ft"><div class="ft-in">
  <span class="ft-brand"><b>TREND</b>HOLIC</span>
  <nav class="ft-nav"><a href="/catalog/">Catalog</a><a href="/index.html">Store</a></nav>
  <span class="ft-cp">© TrendHolic</span>
</div></footer>
${CART_DRAWER}
<div id="results" class="results" hidden></div>
<script src="/catalog/catalog.js" defer></script>
<script src="/catalog/catalog-cart.js" defer></script>
</body></html>`;
}

// Display a currency amount with a friendly symbol (real data only; blank if none).
const curSym = (c) => ({ USD: "$", AED: "AED ", EUR: "€", GBP: "£" }[c] || (c ? c + " " : "$"));
const priceHtml = (r) => r.price
  ? `<span class="pr">${curSym(r.currency)}${esc(r.price)}${r.compare_at_price && r.compare_at_price !== r.price ? ` <s>${curSym(r.currency)}${esc(r.compare_at_price)}</s>` : ""}</span>`
  : "";
const card = (r) => `<a class="card" href="${cp}/product/${esc(r.slug)}/">
  ${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<div class="ph"></div>`}
  <div class="cb"><span class="tag">${esc(r.top)}</span><span class="nm">${esc(r.name)}</span>${r.brand ? `<span class="br">${esc(r.brand)}</span>` : ""}${priceHtml(r)}</div></a>`;

function main() {
  const topCategories = [];
  const allRecords = [];
  const productsByTop = {};

  for (const src of CONFIG.sources) {
    const topSlug = src.slug || slugify(src.top);
    const prodDir = path.join(dataDir, topSlug, "products");
    const cats = readJson(path.join(dataDir, topSlug, "categories.json"), { categories: [] });
    const products = [];
    if (fs.existsSync(prodDir)) {
      for (const f of fs.readdirSync(prodDir).filter((x) => x.endsWith(".json"))) {
        const p = readJson(path.join(prodDir, f), null); if (!p) continue;
        p._url = `${cp}/product/${p.slug}/`;
        p._canonical = `${base}${cp}/product/${p.slug}/`;
        p._og = p.images?.[0]?.src ? base + p.images[0].src : null;
        products.push(p);
        allRecords.push({
          slug: p.slug, name: p.name, top: p.top_category, topSlug,
          brand: p.brand || "", model: p.model_number || "", sku: p.sku || "",
          price: p.price || "", currency: p.currency || "", compare_at_price: p.compare_at_price || "",
          category: p.source_category || "", image: p.images?.[0]?.src || null,
          url: p._url, canonical: p._canonical,
          keywords: [p.name, p.brand, p.top_category, p.source_category, ...(Array.isArray(p.source_categories) ? p.source_categories.map((c) => c.name) : [])].filter(Boolean),
        });
      }
    }
    products.sort((a, b) => a.name.localeCompare(b.name));
    // Group products by their REAL supplier subcategories (multi-membership).
    // A product with no mapped category simply doesn't appear under a subcategory
    // (it's still reachable via the top listing and search) — nothing invented.
    const subcats = new Map(); // slug -> {name, slug, source_path, parent_path, products:[]}
    for (const p of products) {
      const pcats = Array.isArray(p.source_categories) ? p.source_categories : [];
      for (const c of pcats) {
        if (!c || !c.slug) continue;
        if (!subcats.has(c.slug)) subcats.set(c.slug, { name: c.name || c.slug, slug: c.slug, source_path: c.source_path || null, parent_path: c.parent_path || null, products: [] });
        subcats.get(c.slug).products.push(p);
      }
    }
    const subcatList = [...subcats.values()].sort((a, b) => a.name.localeCompare(b.name));
    productsByTop[topSlug] = { top: src.top, slug: topSlug, products, subcats: subcatList };
    writeJson(path.join(CONFIG.out.catalogDir, `${topSlug}.json`), {
      top: src.top, slug: topSlug, productCount: products.length,
      subcategoriesDiscovered: cats.categories?.length || 0,
      subcategories: (cats.categories || []).map((c) => ({ name: c.name, slug: c.slug, source_path: c.source_path })),
      products,
    });
    topCategories.push({ name: src.top, slug: topSlug, productCount: products.length, subcategoriesDiscovered: cats.categories?.length || 0 });
  }

  // ---- data indexes ----
  writeJson(path.join(CONFIG.out.catalogDir, "_index.json"), {
    updatedAt: new Date().toISOString(), topCategories,
    totals: { topCategories: topCategories.length, products: allRecords.length,
      subcategoriesDiscovered: topCategories.reduce((n, t) => n + t.subcategoriesDiscovered, 0) },
  });
  writeJson(CONFIG.out.searchIndex, { updatedAt: new Date().toISOString(), count: allRecords.length, records: allRecords });

  // ---- shared CSS + JS (search + gallery) ----
  writeFile(path.join(repo, "catalog", "catalog.css"), CATALOG_CSS);
  writeFile(path.join(repo, "catalog", "catalog.js"), CATALOG_JS);
  writeFile(path.join(repo, "catalog", "catalog-cart.js"), CATALOG_CART_JS);

  // ---- landing ----
  const catCards = topCategories.map((t) =>
    `<a class="topcard" href="${cp}/${t.slug}/"><span class="tn">${esc(t.name)}</span><span class="tc">${t.productCount} product${t.productCount === 1 ? "" : "s"}</span></a>`).join("");
  // Featured: a balanced, image-first selection across the categories so the
  // landing stays fast and visual. The full set is one click away per category
  // or via search — nothing is hidden, just not all dumped onto the front page.
  const FEATURED_MAX = 32;
  const byTop = {};
  for (const r of allRecords) { if (!r.image) continue; (byTop[r.topSlug] ||= []).push(r); }
  for (const arr of Object.values(byTop)) arr.sort((a, b) => a.name.localeCompare(b.name));
  const featuredRecords = [];
  for (let round = 0; featuredRecords.length < FEATURED_MAX && round < 1000; round++) {
    let progressed = false;
    for (const t of topCategories) {
      const arr = byTop[t.slug];
      if (arr && arr.length) { featuredRecords.push(arr.shift()); progressed = true; if (featuredRecords.length >= FEATURED_MAX) break; }
    }
    if (!progressed) break;
  }
  const featured = featuredRecords.map(card).join("");
  const heroLine = topCategories.map((t) => t.name).join(" · ");
  writeFile(path.join(repo, "catalog", "index.html"), page({
    title: "Catalog | TrendHolic", desc: `Browse the TrendHolic catalog — ${heroLine}.`,
    canonical: `${base}${cp}/`, ogImage: featuredRecords[0]?.image ? base + featuredRecords[0].image : null,
    body: `<section class="hero"><h1>TrendHolic Catalog</h1><p>${esc(heroLine)}</p></section>
      <h2 class="sec">Browse by category</h2>
      <div class="tops">${catCards}</div>
      <h2 class="sec">Featured selection</h2>
      <div class="grid">${featured}</div>
      <p class="more muted">Browse a category above or search to see all ${allRecords.length} products.</p>`,
  }));

  // ---- category pages (top) + per-subcategory pages ----
  for (const t of Object.values(productsByTop)) {
    const subs = t.subcats || [];
    const subNav = subs.length
      ? `<h2 class="sec">Shop by subcategory <span class="muted">(${subs.length})</span></h2>
         <div class="subs">${subs.map((s) =>
            `<a class="subcard" href="${cp}/${t.slug}/${esc(s.slug)}/"><span class="sn">${esc(s.name)}</span><span class="sc">${s.products.length}</span></a>`).join("")}</div>`
      : "";
    writeFile(path.join(repo, "catalog", t.slug, "index.html"), page({
      title: `${t.top} | TrendHolic Catalog`, desc: `${t.top} in the TrendHolic catalog — ${t.products.length} products.`,
      canonical: `${base}${cp}/${t.slug}/`, ogImage: t.products[0]?.images?.[0]?.src ? base + t.products[0].images[0].src : null,
      body: `<nav class="crumb"><a href="${cp}/">Catalog</a> › <span>${esc(t.top)}</span></nav>
        <h1>${esc(t.top)} <span class="muted">(${t.products.length})</span></h1>
        ${subNav}
        <h2 class="sec">All ${esc(t.top)}</h2>
        <div class="grid">${t.products.map((p) => card({ slug: p.slug, name: p.name, top: p.top_category, image: p.images?.[0]?.src || null, brand: p.brand, price: p.price, currency: p.currency, compare_at_price: p.compare_at_price })).join("") || '<p class="muted">No products yet.</p>'}</div>`,
    }));

    // per-subcategory listing pages (real supplier categories → products)
    for (const s of subs) {
      writeFile(path.join(repo, "catalog", t.slug, s.slug, "index.html"), page({
        title: `${s.name} — ${t.top} | TrendHolic Catalog`,
        desc: truncate(`${s.name} in ${t.top} — ${s.products.length} products in the TrendHolic catalog.`, 155),
        canonical: `${base}${cp}/${t.slug}/${s.slug}/`,
        ogImage: s.products[0]?.images?.[0]?.src ? base + s.products[0].images[0].src : null,
        body: `<nav class="crumb"><a href="${cp}/">Catalog</a> › <a href="${cp}/${t.slug}/">${esc(t.top)}</a> › <span>${esc(s.name)}</span></nav>
          <h1>${esc(s.name)} <span class="muted">(${s.products.length})</span></h1>
          <div class="grid">${s.products.map((p) => card({ slug: p.slug, name: p.name, top: p.top_category, image: p.images?.[0]?.src || null, brand: p.brand, price: p.price, currency: p.currency, compare_at_price: p.compare_at_price })).join("") || '<p class="muted">No products yet.</p>'}</div>`,
      }));
    }
  }

  // ---- product pages ----
  for (const t of Object.values(productsByTop)) {
    for (const p of t.products) {
      const imgs = p.images || [];
      const jsonld = { "@context": "https://schema.org", "@type": "Product", name: p.name,
        image: imgs.map((i) => base + i.src), category: p.top_category, url: p._canonical,
        ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
        ...(p.model_number ? { model: p.model_number } : {}),
        ...(p.sku ? { sku: String(p.sku) } : {}),
        ...(p.description ? { description: truncate(p.description, 300) } : {}),
        ...(p.price ? { offers: { "@type": "Offer", price: String(p.price), priceCurrency: p.currency || "USD",
          availability: `https://schema.org/${p.availability === "Out of stock" ? "OutOfStock" : "InStock"}`, url: p._canonical } } : {}) };
      writeFile(path.join(repo, "catalog", "product", p.slug, "index.html"), page({
        title: `${p.name} | TrendHolic ${p.top_category}`,
        desc: truncate(`${p.name} — ${p.top_category} in the TrendHolic catalog.`, 155),
        canonical: p._canonical, ogImage: p._og, jsonld,
        body: `<nav class="crumb"><a href="${cp}/">Catalog</a> › <a href="${cp}/${t.slug}/">${esc(p.top_category)}</a> › <span>${esc(p.name)}</span></nav>
        <div class="detail">
          <div class="gallery">
            <img id="main-img" src="${esc(imgs[0]?.src || "")}" alt="${esc(p.name)}">
            <div class="thumbs">${imgs.map((i) => `<img src="${esc(i.src)}" alt="${esc(i.alt || p.name)}">`).join("")}</div>
          </div>
          <div class="info">
            <span class="tag">${esc(p.top_category)}</span><h1>${esc(p.name)}</h1>
            ${p.brand ? `<div class="p-brand">${esc(p.brand)}</div>` : ""}
            ${p.price ? `<div class="price">${curSym(p.currency)}${esc(p.price)}${p.compare_at_price && p.compare_at_price !== p.price ? ` <s>${curSym(p.currency)}${esc(p.compare_at_price)}</s>` : ""}</div>` : ""}
            <div class="buy">
              <div class="qtyctl"><button type="button" class="q-dec" aria-label="Decrease quantity">−</button><input class="q-in" type="number" min="1" value="1" aria-label="Quantity"><button type="button" class="q-inc" aria-label="Increase quantity">+</button></div>
              <button type="button" class="add-cart wa-add" data-slug="${esc(p.slug)}" data-name="${esc(p.name)}" data-ref="${esc(p.model_number || p.sku || p.parent_product_id || "")}" data-price="${esc(p.price ?? "")}" data-currency="${esc(curSym(p.currency))}" data-image="${esc(imgs[0]?.src || "")}" data-url="${esc(p._url)}">Add to Cart</button>
            </div>
            <dl class="kv">
              <dt>Brand</dt><dd>${na(p.brand)}</dd>
              ${p.size ? `<dt>Size</dt><dd>${na(p.size)}</dd>` : ""}
              <dt>Model</dt><dd>${na(p.model_number)}</dd>
              <dt>SKU</dt><dd>${na(p.sku)}</dd>
              <dt>Product ID</dt><dd>${na(p.parent_product_id)}</dd>
              <dt>Description</dt><dd>${na(p.description)}</dd>
              <dt>Materials</dt><dd>${na(p.materials)}</dd>
              <dt>Dimensions</dt><dd>${na(p.dimensions)}</dd>
              <dt>Price</dt><dd>${p.price ? `${curSym(p.currency)}${esc(p.price)}` : na(p.price)}</dd>
              ${p.availability ? `<dt>Availability</dt><dd>${na(p.availability)}</dd>` : ""}
              <dt>Images</dt><dd>${imgs.length}</dd>
            </dl>
          </div>
        </div>`,
      }));
    }
  }

  // ---- sitemap.xml (TrendHolic canonical only) ----
  const now = new Date().toISOString().slice(0, 10);
  const x = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
  const subUrls = Object.values(productsByTop).flatMap((t) => (t.subcats || []).map((s) => `${base}${cp}/${t.slug}/${s.slug}/`));
  const urls = [`${base}/`, `${base}${cp}/`, ...topCategories.map((t) => `${base}${cp}/${t.slug}/`), ...subUrls, ...allRecords.map((r) => r.canonical)];
  writeFile(CONFIG.out.sitemap, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${x(u)}</loc><lastmod>${now}</lastmod></url>`).join("\n") + `\n</urlset>\n`);

  // ---- robots.txt ----
  writeFile(path.join(repo, "robots.txt"), `# managed-by: trendholic-product-sync\nUser-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

  console.log(JSON.stringify({ topCategories: topCategories.map((t) => `${t.name}:${t.productCount}`),
    subcategoriesLinked: subUrls.length, products: allRecords.length,
    staticPages: 1 + topCategories.length + subUrls.length + allRecords.length, sitemapUrls: urls.length }, null, 2));
}

const CATALOG_CSS = `:root{--ink:#0B1929;--paper:#F6F3EE;--surface:#fff;--surface2:#faf7f1;--rule:#e4ded4;--gold:#A9781F;--muted:#6a7683}
@media(prefers-color-scheme:dark){:root{--ink:#ece7df;--paper:#0d141c;--surface:#141e29;--surface2:#111a23;--rule:#243240;--gold:#d4a24c;--muted:#8394a3}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
a{color:inherit;text-decoration:none}img{max-width:100%}
.cat-hd{position:sticky;top:0;z-index:20;background:var(--surface);border-bottom:1px solid var(--rule);display:flex;gap:14px;align-items:center;padding:12px 18px;flex-wrap:wrap}
.brand{font-weight:700;font-size:1.05rem}.brand b{color:var(--gold)}
#q{flex:1;min-width:150px;padding:9px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--paper);color:var(--ink)}
.store{font-size:.85rem;color:var(--muted)}
.cat-main{max-width:1180px;margin:0 auto;padding:20px}
.hero{padding:22px 0 8px}.hero h1{margin:0;font-size:1.9rem}.hero p{color:var(--muted);margin:6px 0 0}
.sec{font-size:1rem;text-transform:uppercase;letter-spacing:.06em;color:var(--gold);margin:26px 0 12px}.muted{color:var(--muted)}
.tops{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:18px 0}
@media(max-width:640px){.tops{grid-template-columns:repeat(2,1fr)}}
.topcard{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:22px 16px;display:flex;flex-direction:column;gap:6px}
.topcard:hover{border-color:var(--gold)}.tn{font-weight:700;font-size:1.1rem}.tc{color:var(--muted);font-size:.85rem}
.subs{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 6px}
.subcard{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--rule);border-radius:20px;padding:8px 14px;font-size:.88rem}
.subcard:hover{border-color:var(--gold)}.subcard .sn{font-weight:600}.subcard .sc{color:var(--muted);font-size:.78rem;background:var(--surface2);border-radius:10px;padding:1px 7px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.card:hover{border-color:var(--gold)}.card img,.card .ph{width:100%;height:180px;object-fit:cover;background:var(--surface2)}
.cb{padding:10px 12px;display:flex;flex-direction:column;gap:3px}.tag{font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gold);font-weight:700}
.nm{font-size:.85rem;font-weight:600;line-height:1.25}
.br{font-size:.72rem;color:var(--muted)}
.pr{font-size:.9rem;font-weight:700;color:var(--gold);margin-top:2px}.pr s{color:var(--muted);font-weight:400;font-size:.78rem}
.p-brand{color:var(--muted);font-size:.9rem;margin:2px 0}
.price{font-size:1.35rem;font-weight:700;color:var(--gold);margin:8px 0}.price s{color:var(--muted);font-weight:400;font-size:1rem;margin-left:6px}
.crumb{font-size:.82rem;color:var(--muted);margin:6px 0 14px}.crumb a:hover{color:var(--gold)}
.detail{display:grid;grid-template-columns:minmax(0,1.1fr) 1fr;gap:26px}@media(max-width:760px){.detail{grid-template-columns:1fr}}
.gallery #main-img{width:100%;border-radius:12px;border:1px solid var(--rule);background:var(--surface2)}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.thumbs img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--rule);cursor:pointer}
.info h1{font-size:1.4rem;margin:6px 0}.kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;font-size:.9rem;margin-top:12px}
.kv dt{color:var(--muted)}.kv dd{margin:0}.na{color:var(--muted);font-style:italic}
.results{position:fixed;top:58px;left:0;right:0;max-width:1180px;margin:0 auto;background:var(--surface);border:1px solid var(--rule);border-radius:0 0 12px 12px;max-height:70vh;overflow:auto;z-index:19;padding:8px}
.results a{display:flex;gap:10px;align-items:center;padding:8px;border-radius:8px}.results a:hover{background:var(--surface2)}
.results img{width:44px;height:44px;object-fit:cover;border-radius:6px}
.more{margin:18px 0 4px;font-size:.9rem}
.cat-ft{border-top:1px solid var(--rule);background:var(--surface);margin-top:44px}
.ft-in{max-width:1180px;margin:0 auto;padding:22px 20px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:.85rem;color:var(--muted)}
.ft-brand b{color:var(--gold)}.ft-nav{display:flex;gap:18px}.ft-nav a:hover{color:var(--gold)}
/* ---- cart ---- */
.cart-open{position:relative;background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:8px 10px;font-size:1.05rem;cursor:pointer;color:var(--ink);line-height:1}
.cart-open:hover{border-color:var(--gold)}
.cart-count{position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 4px;background:var(--gold);color:#fff;border-radius:9px;font-size:.7rem;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.buy{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0 4px}
.qtyctl{display:inline-flex;align-items:center;border:1px solid var(--rule);border-radius:8px;overflow:hidden;background:var(--surface)}
.qtyctl button{width:38px;height:40px;border:0;background:transparent;color:var(--ink);font-size:1.2rem;cursor:pointer}
.qtyctl button:hover{background:var(--surface2)}
.qtyctl .q-in{width:52px;height:40px;border:0;border-left:1px solid var(--rule);border-right:1px solid var(--rule);text-align:center;background:var(--paper);color:var(--ink);font-size:1rem}
.wa-btn,.wa-add{background:#25D366;color:#04331b;border:0;border-radius:8px;padding:12px 16px;font-weight:700;font-size:.95rem;cursor:pointer}
.wa-btn:hover,.wa-add:hover{filter:brightness(1.06)}.wa-btn:disabled{opacity:.5;cursor:not-allowed;filter:none}
.wa-add{flex:1;min-width:150px;min-height:44px}
.cart-drawer{position:fixed;inset:0;z-index:40}
.cart-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}
.cart-panel{position:absolute;top:0;right:0;height:100%;width:min(420px,100%);background:var(--surface);border-left:1px solid var(--rule);display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(0,0,0,.2)}
.cart-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--rule)}
.cart-hd h2{margin:0;font-size:1.15rem}
.cart-x{background:none;border:0;font-size:1.1rem;cursor:pointer;color:var(--muted)}
.cart-items{flex:1;overflow:auto;padding:8px 14px}
.cart-empty{color:var(--muted);padding:24px 6px;text-align:center}
.cart-row{display:grid;grid-template-columns:56px 1fr auto auto;gap:10px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--rule)}
.cart-row img,.cart-ph{width:56px;height:56px;object-fit:cover;border-radius:8px;background:var(--surface2)}
.cart-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.cart-nm{font-size:.85rem;font-weight:600;line-height:1.25}.cart-ref{font-size:.72rem;color:var(--muted)}.cart-pr{font-size:.78rem;color:var(--gold);font-weight:700}
.cart-qty{display:inline-flex;align-items:center;border:1px solid var(--rule);border-radius:7px;overflow:hidden}
.cart-qty button{width:28px;height:32px;border:0;background:transparent;color:var(--ink);cursor:pointer;font-size:1rem}
.cart-qty .q-in{width:38px;height:32px;border:0;border-left:1px solid var(--rule);border-right:1px solid var(--rule);text-align:center;background:var(--paper);color:var(--ink)}
.cart-rm{background:none;border:0;color:var(--muted);cursor:pointer;font-size:.9rem}
.cart-form{padding:10px 16px;border-top:1px solid var(--rule)}
.cart-form summary{cursor:pointer;color:var(--muted);font-size:.85rem;margin-bottom:8px}
.cart-form input,.cart-form textarea{width:100%;margin:5px 0;padding:9px 10px;border:1px solid var(--rule);border-radius:8px;background:var(--paper);color:var(--ink);font:inherit}
.cart-ft{padding:14px 16px;border-top:1px solid var(--rule)}
.cart-sum{font-size:.9rem;margin-bottom:10px}
.cart-ft .wa-btn{width:100%;min-height:48px}
.cart-clear{width:100%;margin-top:8px;background:none;border:1px solid var(--rule);border-radius:8px;padding:9px;color:var(--muted);cursor:pointer}
.cart-note{font-size:.75rem;color:var(--muted);text-align:center;margin:10px 0 0}
@media(max-width:480px){.cat-hd{gap:8px}.cart-open{padding:8px}}`;

const CATALOG_JS = `(function(){
  var q=document.getElementById('q'),box=document.getElementById('results'),idx=null;
  if(!q)return;
  function load(){return idx?Promise.resolve(idx):fetch('/data/search-index.json').then(function(r){return r.json()}).then(function(j){idx=j.records||[];return idx})}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function run(){var t=q.value.trim().toLowerCase();if(!t){box.hidden=true;box.innerHTML='';return}
    load().then(function(recs){var m=recs.filter(function(r){return (r.name+' '+r.brand+' '+r.model+' '+r.sku+' '+(r.keywords||[]).join(' ')).toLowerCase().indexOf(t)>=0}).slice(0,20);
      box.innerHTML=m.length?m.map(function(r){return '<a href="'+esc(r.url)+'">'+(r.image?'<img src="'+esc(r.image)+'" alt="">':'')+'<span><b>'+esc(r.name)+'</b><br><small>'+esc(r.top)+'</small></span></a>'}).join(''):'<div style="padding:12px;color:#888">No matches.</div>';
      box.hidden=false})}
  q.addEventListener('input',run);
  document.addEventListener('click',function(e){if(e.target!==q&&!box.contains(e.target))box.hidden=true});
  // product gallery thumbnail switch
  var main=document.getElementById('main-img');
  if(main){document.querySelectorAll('.thumbs img').forEach(function(t){t.addEventListener('click',function(){main.src=t.src})})}
})();`;

// Customer cart + WhatsApp wholesale checkout. Vanilla JS, no dependencies.
// State persists in localStorage so the cart survives navigation and refresh.
// The WhatsApp number is injected from the single WHATSAPP_NUMBER constant.
const CATALOG_CART_JS = `(function(){
  var WA=${JSON.stringify(WHATSAPP_NUMBER)};
  var KEY='trendholic_catalog_cart_v1', FKEY='trendholic_catalog_customer_v1';
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function load(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch(e){return[]}}
  function save(items){try{localStorage.setItem(KEY,JSON.stringify(items))}catch(e){}render()}
  function loadCust(){try{return JSON.parse(localStorage.getItem(FKEY))||{}}catch(e){return{}}}
  function saveCust(c){try{localStorage.setItem(FKEY,JSON.stringify(c))}catch(e){}}
  function count(){return load().reduce(function(n,i){return n+(i.qty||0)},0)}
  function idx(items,slug){for(var i=0;i<items.length;i++)if(items[i].slug===slug)return i;return -1}
  function hasPrice(i){return i.price!=null&&i.price!==''}
  function add(item,qty){var items=load(),i=idx(items,item.slug);qty=Math.max(1,qty||1);
    if(i>=0)items[i].qty+=qty;else{item.qty=qty;items.push(item)}save(items);openDrawer()}
  function setQty(slug,q){var items=load(),i=idx(items,slug);if(i<0)return;items[i].qty=q;if(items[i].qty<=0)items.splice(i,1);save(items)}
  function remove(slug){var items=load(),i=idx(items,slug);if(i>=0)items.splice(i,1);save(items)}

  function render(){
    var c=count(),badge=document.getElementById('cart-count');
    if(badge){badge.textContent=c;badge.hidden=!c}
    var body=document.getElementById('cart-items');if(!body)return;
    var items=load();
    if(!items.length){body.innerHTML='<p class="cart-empty">Your cart is empty. Browse the catalog and add products to build your order.</p>'}
    else{body.innerHTML=items.map(function(i){return '<div class="cart-row" data-slug="'+esc(i.slug)+'">'+
      (i.image?'<img src="'+esc(i.image)+'" alt="" onerror="this.style.visibility=\\'hidden\\'">':'<div class="cart-ph"></div>')+
      '<div class="cart-meta"><a class="cart-nm" href="'+esc(i.url)+'">'+esc(i.name)+'</a>'+
      (i.ref?'<span class="cart-ref">Ref/Model: '+esc(i.ref)+'</span>':'')+
      (hasPrice(i)?'<span class="cart-pr">'+esc(i.currency||'$')+esc(i.price)+'</span>':'')+'</div>'+
      '<div class="cart-qty"><button type="button" class="q-dec" aria-label="Decrease">−</button>'+
      '<input class="q-in" type="number" min="1" value="'+esc(i.qty)+'" aria-label="Quantity">'+
      '<button type="button" class="q-inc" aria-label="Increase">+</button></div>'+
      '<button type="button" class="cart-rm" aria-label="Remove">✕</button></div>'}).join('')}
    var t=document.getElementById('cart-total-items');if(t)t.textContent=c;
    var co=document.getElementById('cart-checkout');if(co)co.disabled=!items.length;
  }

  function readForm(){var g=function(id){var e=document.getElementById(id);return e?e.value.trim():''};
    return{name:g('cf-name'),company:g('cf-company'),phone:g('cf-phone'),address:g('cf-address')}}
  function fillForm(){var c=loadCust();['name','company','phone','address'].forEach(function(k){var e=document.getElementById('cf-'+k);if(e&&c[k])e.value=c[k]})}

  function buildMessage(){
    var items=load(),cust=readForm();
    var L=['Hello TrendHolic, I would like to place a wholesale order:',''];
    items.forEach(function(i,n){L.push((n+1)+'. '+i.name);
      if(i.ref)L.push('   SKU/Model: '+i.ref);
      L.push('   Quantity: '+i.qty);
      if(hasPrice(i))L.push('   Price: '+(i.currency||'$')+i.price);
      L.push('')});
    L.push('Total Items: '+count());
    L.push('Please confirm availability and final wholesale pricing.');
    L.push('');
    L.push('Customer Name: '+(cust.name||''));
    L.push('Company: '+(cust.company||''));
    L.push('Phone: '+(cust.phone||''));
    L.push('Shipping Address: '+(cust.address||''));
    return L.join('\\n');
  }
  function checkout(){if(!load().length)return;saveCust(readForm());
    var url='https://wa.me/'+WA+'?text='+encodeURIComponent(buildMessage());
    window.open(url,'_blank','noopener')}

  var drawer=document.getElementById('cart-drawer');
  function openDrawer(){if(drawer){drawer.hidden=false;document.body.style.overflow='hidden'}}
  function closeDrawer(){if(drawer){drawer.hidden=true;document.body.style.overflow=''}}

  // ---- wiring ----
  var btn=document.getElementById('cart-btn');if(btn)btn.addEventListener('click',openDrawer);
  var co=document.getElementById('cart-checkout');if(co)co.addEventListener('click',checkout);
  var clr=document.getElementById('cart-clear');if(clr)clr.addEventListener('click',function(){if(load().length&&confirm('Clear all items from your order?'))save([])});
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-cart-close]')){closeDrawer();return}
    var addBtn=e.target.closest('.add-cart');
    if(addBtn){var box=addBtn.closest('.buy'),qin=box?box.querySelector('.q-in'):null,q=qin?parseInt(qin.value,10):1;
      add({slug:addBtn.getAttribute('data-slug'),name:addBtn.getAttribute('data-name'),ref:addBtn.getAttribute('data-ref'),
        price:addBtn.getAttribute('data-price'),currency:addBtn.getAttribute('data-currency'),
        image:addBtn.getAttribute('data-image'),url:addBtn.getAttribute('data-url')},q);return}
    var row=e.target.closest('.cart-row');
    if(row){var slug=row.getAttribute('data-slug');
      if(e.target.closest('.cart-rm')){remove(slug);return}
      if(e.target.closest('.q-inc')){var i=idx(load(),slug);setQty(slug,(load()[i].qty||0)+1);return}
      if(e.target.closest('.q-dec')){var j=idx(load(),slug);setQty(slug,(load()[j].qty||0)-1);return}}
  });
  // product-page quantity stepper (buy box, not in cart drawer)
  document.querySelectorAll('.buy .qtyctl').forEach(function(ctl){
    var input=ctl.querySelector('.q-in');
    ctl.querySelector('.q-inc').addEventListener('click',function(){input.value=Math.max(1,(parseInt(input.value,10)||1)+1)});
    ctl.querySelector('.q-dec').addEventListener('click',function(){input.value=Math.max(1,(parseInt(input.value,10)||1)-1)});
  });
  // cart-row qty typing
  document.addEventListener('change',function(e){var row=e.target.closest('.cart-row');
    if(row&&e.target.classList.contains('q-in')){setQty(row.getAttribute('data-slug'),Math.max(1,parseInt(e.target.value,10)||1))}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer()});
  // reflect cart changes made in another tab
  window.addEventListener('storage',function(e){if(e.key===KEY)render()});
  fillForm();render();
})();`;

main();
