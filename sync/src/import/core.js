// Pure validation and public projection. Never spread a provider object into an export.
import crypto from 'node:crypto';

export class ReviewError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const requireValue = (condition, code) => { if (!condition) throw new ReviewError(code); };
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const slugify = text => String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/, '');
export function sourceUrl(value) {
  requireValue(typeof value === 'string' && value.length < 2048, 'INVALID_URL');
  let url;
  try { url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`); } catch { throw new ReviewError('INVALID_URL'); }
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port, 'INVALID_URL');
  requireValue(['detail.1688.com', 'm.1688.com'].includes(url.hostname), 'INVALID_URL');
  const id = /^\/offer\/(\d{6,20})\.html$/.exec(url.pathname)?.[1];
  requireValue(id, 'INVALID_URL');
  return { id, url: `https://detail.1688.com/offer/${id}.html` };
}
const forbidden = /[\u3400-\u9fff]|1688|alibaba|taobao|wholesale|supplier|factory\s*direct|wechat|whatsapp|https?:|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:CNY|RMB)\b|[¥￥]|<|>/i;
export function retailText(value, max = 2000, deny = []) {
  requireValue(typeof value === 'string', 'INVALID_COPY');
  const text = value.replace(/\s+/g, ' ').trim();
  requireValue(text.length > 0 && text.length <= max && !forbidden.test(text), 'UNSAFE_COPY');
  requireValue(!deny.filter(Boolean).some(x => text.toLowerCase().includes(String(x).toLowerCase())), 'SOURCE_LEAK');
  requireValue(!/(?:\+?\d[\s().-]*){10,}/.test(text), 'CONTACT_OR_ID');
  return text;
}
export function normalizeSource(raw, identity) {
  requireValue(raw && raw.offerId === identity.id && raw.currency === 'CNY', 'SOURCE_IDENTITY');
  requireValue(typeof raw.title === 'string' && raw.title.trim() && raw.title.length <= 5000, 'MISSING_TITLE');
  requireValue(Array.isArray(raw.images) && raw.images.length > 0 && raw.images.length <= 40, 'MISSING_IMAGES');
  requireValue(Array.isArray(raw.variants || []) && (raw.variants || []).length <= 100, 'INVALID_VARIANTS');
  const variants = raw.variants || [];
  const ids = new Set();
  for (const v of variants) {
    requireValue(typeof v.id === 'string' && v.id && !ids.has(v.id) && Array.isArray(v.options) && v.options.length, 'INVALID_VARIANTS');
    ids.add(v.id);
    requireValue(v.options.every(o => typeof o.name === 'string' && typeof o.value === 'string'), 'INVALID_VARIANTS');
    decimal(v.costCny);
  }
  // Ranges/tier prices must be resolved by the authorized provider to one sellable unit.
  requireValue(raw.priceBasis === 'single-unit' && !raw.priceRange && !raw.priceTiers, 'AMBIGUOUS_PRICE');
  decimal(raw.costCny);
  return { title: raw.title, description: String(raw.description || '').slice(0, 16000),
    specifications: raw.specifications || {}, features: raw.features || [], packageContents: raw.packageContents || [],
    variants, costCny: String(raw.costCny), images: [...new Set(raw.images)],
    supplierName: String(raw.supplierName || ''), supplierIdentifiers: Array.isArray(raw.supplierIdentifiers) ? raw.supplierIdentifiers.map(String) : [] };
}
function decimal(value) {
  const text = String(value);
  requireValue(/^\d{1,8}(\.\d{1,8})?$/.test(text), 'INVALID_PRICE');
  const [whole, frac = ''] = text.split('.');
  const numerator = BigInt(whole + frac);
  requireValue(numerator > 0n, 'INVALID_PRICE');
  return [numerator, 10n ** BigInt(frac.length)];
}
export function pricing(cost, rate, mode = 'retail99') {
  const [c, cd] = decimal(cost), [r, rd] = decimal(rate);
  requireValue(['exact', 'retail99'].includes(mode), 'INVALID_ROUNDING');
  const n = c * r * 2n * 100n, d = cd * rd;
  const cents = (n + d / 2n) / d; // multiply first; round only at USD cent boundary
  requireValue(cents > 0n && cents < 100000000n, 'INVALID_PRICE');
  const retail = ((n + d - 1n) / d + 100n) / 100n * 100n - 1n;
  return { supplierCostRmb: String(cost), exchangeRate: String(rate), supplierCostUsd: Number(cost) * Number(rate),
    calculatedPrice: Number(n) / Number(d) / 100, finalPrice: Number(mode === 'exact' ? cents : retail) / 100, rounding: mode, markup: 1 };
}
const aliases = { 'kitchen-storage': 'kitchen-organization', 'kitchen-organizers': 'kitchen-organization', 'storage': 'home-organization', 'home-organizers': 'home-organization' };
export const categoryKey = name => aliases[slugify(name)] || slugify(name);
export function categoryFor(suggestion, existing) {
  const name = retailText(suggestion.name, 45);
  requireValue(suggestion.confident === true && typeof suggestion.reason === 'string' && suggestion.reason.length > 10, 'CATEGORY_REVIEW');
  const match = existing.find(c => categoryKey(c.name) === categoryKey(name));
  if (match) return { name: match.name, slug: match.slug };
  requireValue(suggestion.distinct === true && !/^(other|miscellaneous|general|home)$/i.test(name), 'CATEGORY_REVIEW');
  const slug = categoryKey(name);
  requireValue(/^[a-z][a-z0-9-]{1,60}$/.test(slug) && !['product', 'index', 'data'].includes(slug), 'CATEGORY_REVIEW');
  requireValue(!existing.some(c => c.slug === slug), 'CATEGORY_COLLISION');
  return { name, slug };
}
export function validateCopy(copy, source, deny) {
  requireValue(copy?.confident === true && Array.isArray(copy.uncertainties) && copy.uncertainties.length === 0, 'TRANSLATION_REVIEW');
  const title = retailText(copy.title, 100, deny);
  requireValue(title.split(' ').length <= 12 && !/hot sale|best seller|20\d\d new/i.test(title), 'TITLE_REVIEW');
  const list = (xs, n, max) => { requireValue(Array.isArray(xs) && xs.length <= n, 'INVALID_COPY'); return xs.map(x => retailText(x, max, deny)); };
  const specifications = {};
  requireValue(copy.specifications && typeof copy.specifications === 'object' && !Array.isArray(copy.specifications) && Object.keys(copy.specifications).length <= 30, 'INVALID_COPY');
  for (const [k, v] of Object.entries(copy.specifications)) {
    requireValue(!/cost|source|supplier|inventory|warehouse|sku|internal|contact|company/i.test(k), 'SOURCE_LEAK');
    specifications[retailText(k, 60, deny)] = retailText(v, 200, deny);
  }
  requireValue(Array.isArray(copy.variants) && copy.variants.length === source.variants.length, 'VARIANT_REVIEW');
  const variants = source.variants.map((v, index) => {
    const translated = copy.variants[index];
    requireValue(translated.sourceId === v.id && Array.isArray(translated.options) && translated.options.length === v.options.length, 'VARIANT_REVIEW');
    return { options: translated.options.map(o => ({ name: retailText(o.name, 40, deny), value: retailText(o.value, 80, deny) })) };
  });
  return { title, description: retailText(copy.description, 700, deny), features: list(copy.features, 6, 180),
    specifications, packageContents: list(copy.packageContents, 15, 180), variants,
    tags: [...new Set(list(copy.tags, 10, 40).map(slugify))].filter(Boolean) };
}
export function uniqueHandle(title, occupied) {
  const base = slugify(title); requireValue(base && /[a-z]/.test(base), 'INVALID_HANDLE');
  if (!occupied.has(base)) return base;
  for (let i = 2; i < 10000; i++) if (!occupied.has(`${base}-${i}`)) return `${base}-${i}`;
  throw new ReviewError('HANDLE_COLLISION');
}
export function publicProduct(copy, category, prices, images, handle, id) {
  return { id, slug: handle, name: copy.title, description: copy.description, top_category: category.name,
    category_slug: category.slug, currency: 'USD', price: prices[0].finalPrice,
    features: copy.features, specifications: copy.specifications, packageContents: copy.packageContents,
    variants: copy.variants.map((v, i) => ({ id: `option-${i + 1}`, options: v.options, price: prices[i + 1].finalPrice })),
    images: images.map((im, i) => ({ src: `/data/imported/images/${handle}-${i + 1}.webp`, alt: copy.title, width: im.width, height: im.height })),
    tags: copy.tags, seo: { title: `${copy.title} | TrendHolic`.slice(0, 65), description: copy.description.slice(0, 155), keywords: copy.tags } };
}
export function assertPublic(p) {
  const allowed = ['id','slug','name','description','top_category','category_slug','currency','price','features','specifications','packageContents','variants','images','tags','seo'];
  requireValue(p && Object.keys(p).every(k => allowed.includes(k)) && allowed.every(k => k in p), 'PUBLIC_SCHEMA');
  requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.category_slug), 'PUBLIC_SCHEMA');
  requireValue(p.currency === 'USD' && Number.isFinite(p.price) && p.price > 0 && p.images.length > 0, 'PUBLIC_SCHEMA');
  const scan = value => {
    if (typeof value === 'string') retailText(value, 2000);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => { retailText(k, 100); scan(v); });
  };
  requireValue(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.id), 'PUBLIC_SCHEMA');
  for (const [k,v] of Object.entries(p)) if (k !== 'id') scan(v);
  requireValue(p.images.every((im, i) => Object.keys(im).every(k => ['src','alt','width','height'].includes(k)) && im.src === `/data/imported/images/${p.slug}-${i + 1}.webp` && im.width >= 300 && im.height >= 300), 'PUBLIC_IMAGE');
  requireValue(p.variants.every(v => Object.keys(v).every(k => ['id','options','price'].includes(k)) && /^option-\d+$/.test(v.id) && Number.isFinite(v.price) && v.price > 0 && v.options.every(o => Object.keys(o).every(k => ['name','value'].includes(k)))), 'PUBLIC_VARIANTS');
}
