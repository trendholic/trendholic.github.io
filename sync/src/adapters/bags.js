// adapters/bags.js — bags.tangma2088.com → top category "Bags".
// Same tangma2088 "album" platform as Apparel. VERIFIED by a real sample crawl
// (2026-07-23): categoryen_ / productinfoen_ / upfile structure confirmed identical.
import { createTangmaAlbumAdapter } from "./tangma-album.js";

export const hostMatch = (host) => /^bags\.tangma2088\.com$/i.test(host);
export const verified = true;  // VERIFIED by real sample crawl 2026-07-23
export const source = { key: "bags", top: "Bags" };
export default createTangmaAlbumAdapter(source);
