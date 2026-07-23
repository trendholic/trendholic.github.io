// adapters/bags.js — bags.tangma2088.com → top category "Bags".
// Same tangma2088 "album" platform as Apparel. NOT yet verified by a reachable
// crawl (proxy 503 from this environment). Confirm selectors on first crawl.
import { createTangmaAlbumAdapter } from "./tangma-album.js";

export const hostMatch = (host) => /^bags\.tangma2088\.com$/i.test(host);
export const verified = false;
export const source = { key: "bags", top: "Bags" };
export default createTangmaAlbumAdapter(source);
