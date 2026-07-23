// adapters/shoes.js — shoes.tangma2088.com → top category "Shoes".
// Same tangma2088 "album" platform as Apparel. NOT yet verified by a reachable
// crawl (proxy 503 from this environment). Confirm selectors on first crawl.
import { createTangmaAlbumAdapter } from "./tangma-album.js";

export const hostMatch = (host) => /^shoes\.tangma2088\.com$/i.test(host);
export const verified = false;
export const source = { key: "shoes", top: "Shoes" };
export default createTangmaAlbumAdapter(source);
