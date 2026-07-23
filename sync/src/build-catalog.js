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
  <a class="store" href="/index.html">← Store</a>
</header>
<main class="cat-main">${body}</main>
<div id="results" class="results" hidden></div>
<script src="/catalog/catalog.js" defer></script>
</body></html>`;
}

const card = (r) => `<a class="card" href="${cp}/product/${esc(r.slug)}/">
  ${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<div class="ph"></div>`}
  <div class="cb"><span class="tag">${esc(r.top)}</span><span class="nm">${esc(r.name)}</span></div></a>`;

function main() {
  const topCategories = [];
  const allRecords = [];
  const productsByTop = {};

  for (const src of CONFIG.sources) {
    const topSlug = slugify(src.top);
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
          category: p.source_category || "", image: p.images?.[0]?.src || null,
          url: p._url, canonical: p._canonical,
          keywords: [p.name, p.top_category, p.source_category].filter(Boolean),
        });
      }
    }
    products.sort((a, b) => a.name.localeCompare(b.name));
    productsByTop[topSlug] = { top: src.top, slug: topSlug, products };
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

  // ---- landing ----
  const catCards = topCategories.map((t) =>
    `<a class="topcard" href="${cp}/${t.slug}/"><span class="tn">${esc(t.name)}</span><span class="tc">${t.productCount} product${t.productCount === 1 ? "" : "s"}</span></a>`).join("");
  const featured = allRecords.map(card).join("");
  writeFile(path.join(repo, "catalog", "index.html"), page({
    title: "Catalog | TrendHolic", desc: "Browse the TrendHolic catalog — Apparel, Accessories, Bags and Shoes.",
    canonical: `${base}${cp}/`, ogImage: allRecords[0]?.image ? base + allRecords[0].image : null,
    body: `<section class="hero"><h1>TrendHolic Catalog</h1><p>Apparel · Accessories · Bags · Shoes</p></section>
      <div class="tops">${catCards}</div>
      <h2 class="sec">All products <span class="muted">(${allRecords.length})</span></h2>
      <div class="grid">${featured}</div>`,
  }));

  // ---- category pages ----
  for (const t of Object.values(productsByTop)) {
    writeFile(path.join(repo, "catalog", t.slug, "index.html"), page({
      title: `${t.top} | TrendHolic Catalog`, desc: `${t.top} in the TrendHolic catalog — ${t.products.length} products.`,
      canonical: `${base}${cp}/${t.slug}/`, ogImage: t.products[0]?.images?.[0]?.src ? base + t.products[0].images[0].src : null,
      body: `<nav class="crumb"><a href="${cp}/">Catalog</a> › <span>${esc(t.top)}</span></nav>
        <h1>${esc(t.top)}</h1>
        <div class="grid">${t.products.map((p) => card({ slug: p.slug, name: p.name, top: p.top_category, image: p.images?.[0]?.src || null })).join("") || '<p class="muted">No products yet.</p>'}</div>`,
    }));
  }

  // ---- product pages ----
  for (const t of Object.values(productsByTop)) {
    for (const p of t.products) {
      const imgs = p.images || [];
      const jsonld = { "@context": "https://schema.org", "@type": "Product", name: p.name,
        image: imgs.map((i) => base + i.src), category: p.top_category, url: p._canonical,
        ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
        ...(p.model_number ? { model: p.model_number } : {}) };
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
            <dl class="kv">
              <dt>Brand</dt><dd>${na(p.brand)}</dd>
              <dt>Model</dt><dd>${na(p.model_number)}</dd>
              <dt>SKU</dt><dd>${na(p.sku)}</dd>
              <dt>Product ID</dt><dd>${na(p.parent_product_id)}</dd>
              <dt>Description</dt><dd>${na(p.description)}</dd>
              <dt>Materials</dt><dd>${na(p.materials)}</dd>
              <dt>Dimensions</dt><dd>${na(p.dimensions)}</dd>
              <dt>Price</dt><dd>${na(p.price)}</dd>
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
  const urls = [`${base}/`, `${base}${cp}/`, ...topCategories.map((t) => `${base}${cp}/${t.slug}/`), ...allRecords.map((r) => r.canonical)];
  writeFile(CONFIG.out.sitemap, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${x(u)}</loc><lastmod>${now}</lastmod></url>`).join("\n") + `\n</urlset>\n`);

  // ---- robots.txt ----
  writeFile(path.join(repo, "robots.txt"), `# managed-by: trendholic-product-sync\nUser-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);

  console.log(JSON.stringify({ topCategories: topCategories.map((t) => `${t.name}:${t.productCount}`),
    products: allRecords.length, staticPages: 1 + topCategories.length + allRecords.length, sitemapUrls: urls.length }, null, 2));
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
.tops{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}
@media(max-width:640px){.tops{grid-template-columns:repeat(2,1fr)}}
.topcard{background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:22px 16px;display:flex;flex-direction:column;gap:6px}
.topcard:hover{border-color:var(--gold)}.tn{font-weight:700;font-size:1.1rem}.tc{color:var(--muted);font-size:.85rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.card:hover{border-color:var(--gold)}.card img,.card .ph{width:100%;height:180px;object-fit:cover;background:var(--surface2)}
.cb{padding:10px 12px;display:flex;flex-direction:column;gap:3px}.tag{font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gold);font-weight:700}
.nm{font-size:.85rem;font-weight:600;line-height:1.25}
.crumb{font-size:.82rem;color:var(--muted);margin:6px 0 14px}.crumb a:hover{color:var(--gold)}
.detail{display:grid;grid-template-columns:minmax(0,1.1fr) 1fr;gap:26px}@media(max-width:760px){.detail{grid-template-columns:1fr}}
.gallery #main-img{width:100%;border-radius:12px;border:1px solid var(--rule);background:var(--surface2)}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.thumbs img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--rule);cursor:pointer}
.info h1{font-size:1.4rem;margin:6px 0}.kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;font-size:.9rem;margin-top:12px}
.kv dt{color:var(--muted)}.kv dd{margin:0}.na{color:var(--muted);font-style:italic}
.results{position:fixed;top:58px;left:0;right:0;max-width:1180px;margin:0 auto;background:var(--surface);border:1px solid var(--rule);border-radius:0 0 12px 12px;max-height:70vh;overflow:auto;z-index:19;padding:8px}
.results a{display:flex;gap:10px;align-items:center;padding:8px;border-radius:8px}.results a:hover{background:var(--surface2)}
.results img{width:44px;height:44px;object-fit:cover;border-radius:6px}`;

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

main();
