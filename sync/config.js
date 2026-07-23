// ============================================================================
// config.js — central configuration. Everything tunable lives here or in env.
// No secrets are stored here; API keys come from environment variables.
// ============================================================================
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const env = (k, d) => (process.env[k] ?? d);
const bool = (k, d = false) => ["1", "true", "yes", "on"].includes(String(env(k, d)).toLowerCase());
const int = (k, d) => { const n = parseInt(env(k, d), 10); return Number.isFinite(n) ? n : d; };

export const CONFIG = {
  // ---- Source --------------------------------------------------------------
  source: {
    baseUrl: env("SOURCE_BASE_URL", "https://macc.tangma2088.com"),
    // Seed category URLs. If empty, the adapter attempts to discover them from
    // the homepage navigation. Prefer seeding once you know the real URLs.
    seedCategories: (env("SEED_CATEGORIES", "") || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    userAgent: env(
      "CRAWL_USER_AGENT",
      "TrendHolicSyncBot/1.0 (+https://trendholic.github.io; contact=onlinetrader002@gmail.com)"
    ),
    respectRobots: !bool("IGNORE_ROBOTS"), // default: respect robots.txt
    // JavaScript rendering: 'auto' tries plain HTTP first and falls back to a
    // headless browser only if the page looks empty / anti-bot blocked.
    render: env("RENDER_MODE", "auto"), // 'auto' | 'always' | 'never'
  },

  // ---- Politeness / reliability -------------------------------------------
  crawl: {
    minDelayMs: int("CRAWL_MIN_DELAY_MS", 1500),   // per-request spacing
    concurrency: int("CRAWL_CONCURRENCY", 3),      // parallel product fetches
    maxRetries: int("CRAWL_MAX_RETRIES", 4),
    timeoutMs: int("CRAWL_TIMEOUT_MS", 30000),
    maxProductsPerCategory: int("MAX_PRODUCTS_PER_CATEGORY", 0), // 0 = no limit
    maxPagesPerCategory: int("MAX_PAGES_PER_CATEGORY", 50),
  },

  // ---- Translation ---------------------------------------------------------
  translate: {
    provider: env("TRANSLATE_PROVIDER", "anthropic"), // 'anthropic' | 'none'
    targetLanguage: "American English",
    model: env("TRANSLATE_MODEL", "claude-opus-4-8"),
    apiKey: env("ANTHROPIC_API_KEY", ""),            // secret, from env only
    // Fields translated. Brand + model numbers + SKU are NEVER translated.
    fields: ["name", "description", "specifications", "features", "technicalData"],
    cacheFile: path.join(REPO_ROOT, "sync", ".state", "translation-cache.json"),
  },

  // ---- Images --------------------------------------------------------------
  images: {
    maxWidth: int("IMAGE_MAX_WIDTH", 1600),
    webpQuality: int("IMAGE_WEBP_QUALITY", 82),
    keepOriginalHighRes: bool("IMAGE_KEEP_ORIGINAL", false),
    maxPerProduct: int("IMAGE_MAX_PER_PRODUCT", 8),
  },

  // ---- Output paths (all additive; retail site untouched) ------------------
  out: {
    repoRoot: REPO_ROOT,
    dataDir: path.join(REPO_ROOT, "data"),
    catalogDir: path.join(REPO_ROOT, "data", "catalog"),   // per-category JSON
    productsDir: path.join(REPO_ROOT, "data", "products"),  // per-product JSON
    imagesDir: path.join(REPO_ROOT, "data", "images"),
    pdfDir: path.join(REPO_ROOT, "data", "manuals"),
    searchIndex: path.join(REPO_ROOT, "data", "search-index.json"),
    syncLog: path.join(REPO_ROOT, "data", "sync-log.json"),
    sitemap: path.join(REPO_ROOT, "sitemap.xml"),
    stateFile: path.join(REPO_ROOT, "sync", ".state", "state.json"),
    logDir: path.join(REPO_ROOT, "sync", "logs"),
    // Public site base for absolute URLs in sitemap / search index.
    siteBaseUrl: env("SITE_BASE_URL", "https://trendholic.github.io"),
    // Public path where the (optional) catalog viewer lives.
    catalogPublicPath: "/catalog/",
  },

  dryRun: bool("DRY_RUN"),
};

export default CONFIG;
