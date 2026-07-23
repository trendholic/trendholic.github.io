// ============================================================================
// grouping.js — deterministic PHYSICAL-PRODUCT identity for the tangma2088
// "album" platform (all four sources).
//
// Evidence (verified live 2026-07-23): each /productinfoen_<id>.html page is
// keyed to a single IMAGE; a physical product owns many images, so many pages
// describe one product. Image URLs end in "_<imageId>.<ext>" on EVERY source,
// but the index token before it differs per source:
//     Apparel/Accessories : "<Base> (n)_<id>.jpg"
//     Bags                : "<Base> AP<n>_<id>.jpg"   (no space/parens)
//     Shoes               : "<Base> 0<n>_<id>.jpg"    (space, zero-padded)
// We derive a source-independent product identity = directory + <Base> (the
// image filename with the trailing index token removed). All images/pages of a
// product share it; different products never do.
//
// Identity priority: (1) shared image-base path  (2) SKU  (3) model+brand
// (4) canonical URL. parent_product_id = the smallest image id in the group.
// ============================================================================

const EXT = /\.(jpe?g|png|webp|gif)$/i;
const ID_TAIL = /_(\d+)\.(jpe?g|png|webp|gif)$/i;   // "_<imageId>.<ext>" (universal)

// Remove the per-source image-index token from a filename stem (stem = filename
// minus "_<id>.<ext>"). Ordered so each source's format is handled unambiguously.
export function stripIndexToken(stem) {
  let s = String(stem);
  const parens = s.replace(/\s*\(\d+\)\s*$/, "");          // " (n)"  → apparel/accessories
  if (parens !== s) return parens.trim();
  const spaced = s.replace(/\s+\d+\s*$/, "");              // " 0n"   → shoes
  if (spaced !== s) return spaced.trim();
  const bare = s.replace(/\d+\s*$/, "");                   // "APn"   → bags
  return bare.trim();
}

export function imageInfo(input) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(input, "https://x/").pathname); }
  catch { pathname = String(input || ""); }
  pathname = pathname.replace(/^\/+/, "");
  const dir = pathname.includes("/") ? pathname.replace(/\/[^/]*$/, "") : "";
  const file = pathname.split("/").pop() || "";

  const m = ID_TAIL.exec(file);
  const imageId = m ? m[1] : null;
  const stem = m ? file.slice(0, m.index) : file.replace(EXT, "");
  const baseName = stripIndexToken(stem);                 // clean product name
  const baseKey = `${dir}/${baseName}`.toLowerCase();     // grouping key
  // best-effort numeric index (for ordering only)
  let index = null;
  const pi = /\((\d+)\)\s*$/.exec(stem) || /\s(\d+)\s*$/.exec(stem) || /(\d+)\s*$/.exec(stem);
  if (pi) index = Number(pi[1]);
  return { dir, file, imageId, stem, baseName, baseKey, index };
}

export const deriveProductName = (baseName) => String(baseName || "").trim();

// Group raw per-page records into physical products.
//   pages: [{ sourceProductId, sourceUrl, name, images:[{source_url|url|src}] }]
export function groupProductPages(pages) {
  const groups = new Map();
  const imgUrlOf = (img) => (typeof img === "string" ? img : (img.source_url || img.url || img.src || ""));

  for (const pg of pages) {
    const imgs = pg.images || [];
    const counts = {};
    for (const img of imgs) { const { baseKey } = imageInfo(imgUrlOf(img)); if (baseKey) counts[baseKey] = (counts[baseKey] || 0) + 1; }
    const baseKey = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!baseKey) continue;

    let g = groups.get(baseKey);
    if (!g) { g = { baseKey, baseName: "", pages: [], byId: new Map(), ids: new Set() }; groups.set(baseKey, g); }
    g.pages.push({ id: pg.sourceProductId, url: pg.sourceUrl });
    for (const img of imgs) {
      const info = imageInfo(imgUrlOf(img));
      if (info.baseKey !== baseKey) continue;
      if (!g.baseName) g.baseName = info.baseName;
      const key = info.imageId || info.file;
      if (!g.byId.has(key)) g.byId.set(key, { img, info });
      if (info.imageId) g.ids.add(info.imageId);
    }
  }

  return [...groups.values()].map((g) => {
    const parentId = [...g.ids].map(Number).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const images = [...g.byId.values()]
      .sort((a, b) => (a.info.index ?? 1e9) - (b.info.index ?? 1e9))
      .map((x) => x.img);
    return {
      parent_product_id: parentId != null ? String(parentId) : null,
      name: deriveProductName(g.baseName),
      image_base: g.baseKey,
      page_ids: g.pages.map((p) => p.id),
      source_product_urls: g.pages.map((p) => p.url),
      images,
    };
  });
}
