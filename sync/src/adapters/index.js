// adapters/index.js — multi-source adapter registry, keyed by hostname.
// Each supplier domain gets its own adapter file; add a supplier by dropping in
// one file and registering it here. The source DOMAIN determines the top-level
// catalog category (Apparel/Accessories/Bags/Shoes).
import { createTangmaAlbumAdapter } from "./tangma-album.js";
import apparel,     { hostMatch as apparelMatch,     verified as apparelV }     from "./apparel.js";
import accessories, { hostMatch as accessoriesMatch, verified as accessoriesV } from "./accessories.js";
import bags,        { hostMatch as bagsMatch,        verified as bagsV }        from "./bags.js";
import shoes,       { hostMatch as shoesMatch,       verified as shoesV }       from "./shoes.js";

const GENERIC = createTangmaAlbumAdapter({ key: "generic", top: "Uncategorized" });

const REGISTRY = [
  { id: "accessories", match: accessoriesMatch, adapter: accessories, verified: accessoriesV, top: "Accessories" },
  { id: "bags",        match: bagsMatch,        adapter: bags,        verified: bagsV,        top: "Bags" },
  { id: "shoes",       match: shoesMatch,       adapter: shoes,       verified: shoesV,       top: "Shoes" },
  { id: "apparel",     match: apparelMatch,     adapter: apparel,     verified: apparelV,     top: "Apparel" },
];

export function getAdapter(baseUrl) {
  let host = ""; try { host = new URL(baseUrl).host; } catch { /* noop */ }
  const hit = REGISTRY.find((r) => r.match(host));
  return hit
    ? { id: hit.id, adapter: hit.adapter, verified: hit.verified, top: hit.top }
    : { id: "generic", adapter: GENERIC, verified: false, top: "Uncategorized" };
}
