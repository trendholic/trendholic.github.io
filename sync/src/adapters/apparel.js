// adapters/apparel.js — tangma2088.com → top category "Apparel".
// VERIFIED against the live site on 2026-07-23 (see tangma-album.js).
import { createTangmaAlbumAdapter } from "./tangma-album.js";

export const hostMatch = (host) =>
  /(^|\.)tangma2088\.com$/i.test(host) && !/^(acc|bags|shoes|macc)\./i.test(host);
export const verified = true;
export const source = { key: "apparel", top: "Apparel" };
export default createTangmaAlbumAdapter(source);
