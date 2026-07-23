// ============================================================================
// adapters/tangma2088.js — site adapter for macc.tangma2088.com
// ★ THIS IS THE ONLY FILE TO EDIT IF THE SUPPLIER CHANGES ITS HTML ★
//
// The site returned HTTP 503 to inspection, so these selectors are documented
// PLACEHOLDERS built from common e-commerce patterns (the engine also auto-uses
// schema.org JSON-LD + OpenGraph when present). After the first successful
// crawl, open a real category page and a real product page and replace each
// selector below. Verify with:
//   MAX_PRODUCTS_PER_CATEGORY=2 TRANSLATE_PROVIDER=none npm run sync:dry
// ============================================================================
import { createAdapter } from "./base.js";

export const hostMatch = (host) => /(^|\.)tangma2088\.com$/i.test(host);

// PLACEHOLDER SELECTORS — verify against the live DOM, then commit the update.
export const SELECTORS = {
  // Homepage / nav → category links
  categoryLinks: "nav a, .nav a, .category a, .menu a, .product-category a, .sidebar a",
  // Category listing
  productLinks: ".product a, .product-item a, .goods-item a, .goods a, li.item a, .list-item a",
  nextPage: "a.next, .pagination a[rel='next'], .next-page a, a.page-next",
  categoryTitle: "h1, .category-title, .page-title, .breadcrumb .active",
  // Product detail
  name: "h1, .product-title, .goods-title, .detail-title",
  sku: "[itemprop='sku'], .sku, .product-sku, .item-sku, .goods-sn",
  brand: "[itemprop='brand'], .brand, .product-brand",
  modelNumber: ".model, [itemprop='model'], .product-model, .goods-model",
  description: "#description, .product-description, .description, [itemprop='description'], .detail-content",
  specsTable: ".specifications table, #specs table, table.spec, .param table, .attributes table",
  features: ".features li, #features li, .product-features li, .selling-point li",
  technicalData: ".technical, .tech-data, #technical",
  images: ".product-gallery img, .gallery img, [itemprop='image'], .product-image img, .thumb img, .swiper-slide img",
  pdfLinks: "a[href$='.pdf'], a[href*='manual'], a[href*='datasheet'], a[href*='instruction']",
  variations: ".variations option, .sku-list li, .variant, .spec-values li",
};

export default createAdapter(SELECTORS);
