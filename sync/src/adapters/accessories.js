// adapters/accessories.js — acc.tangma2088.com → top category "Accessories".
// Same tangma2088 "album" platform as Apparel. NOT yet verified by a reachable
// crawl (this environment's proxy could not reach acc.* — HTTP 503). Confirm the
// selectors on the first successful crawl; edit tangma-album.js only if the DOM
// differs for this subdomain.
import { createTangmaAlbumAdapter } from "./tangma-album.js";

export const hostMatch = (host) => /^acc\.tangma2088\.com$/i.test(host);
export const verified = false;
export const source = { key: "accessories", top: "Accessories" };
export default createTangmaAlbumAdapter(source);
