// adapters/shoes.js — shoes.tangma2088.com → top category "Shoes".
// Same tangma2088 "album" platform as Apparel. VERIFIED by a real sample crawl
// (2026-07-23): categoryen_ / productinfoen_ / upfile structure confirmed identical.
import { createTangmaAlbumAdapter } from "./tangma-album.js";

export const hostMatch = (host) => /^shoes\.tangma2088\.com$/i.test(host);
export const verified = true;  // VERIFIED by real sample crawl 2026-07-23
export const source = { key: "shoes", top: "Shoes" };
export default createTangmaAlbumAdapter(source);
