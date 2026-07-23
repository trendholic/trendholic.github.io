# Configuration Reference

All configuration is via **environment variables** (no secrets in code). Defaults
live in `sync/config.js`. In GitHub Actions, set *secrets* for keys/passwords and
*repository variables* for the rest.

## Source & crawling
| Variable | Default | Description |
|----------|---------|-------------|
| `SOURCE_BASE_URL` | `https://macc.tangma2088.com` | Supplier root URL. |
| `SEED_CATEGORIES` | *(empty)* | Comma-separated category URLs. Recommended once the real URLs are known; otherwise the adapter discovers them from the homepage. |
| `RENDER_MODE` | `auto` | `auto` (HTTP first, browser only if blocked/empty) · `always` · `never`. |
| `CRAWL_USER_AGENT` | identifying bot UA | Sent on every request. |
| `IGNORE_ROBOTS` | *(unset)* | Set to `1` only if you are certain you may ignore robots.txt. Left unset = respected. |
| `CRAWL_CONCURRENCY` | `3` | Parallel product fetches. |
| `CRAWL_MIN_DELAY_MS` | `1500` | Minimum spacing between requests (politeness). |
| `CRAWL_MAX_RETRIES` | `4` | Retry attempts with exponential backoff. |
| `CRAWL_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `MAX_PRODUCTS_PER_CATEGORY` | `0` | `0` = unlimited. Use a small number to test. |
| `MAX_PAGES_PER_CATEGORY` | `50` | Pagination cap per category. |

## Headless browser & login (for Cloudflare / JS sites)
| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_JITTER_MS` | `700` | Random human-like delay before each navigation. |
| `SUPPLIER_LOGIN_URL` | *(empty)* | If the catalog requires login, the login page URL. |
| `SUPPLIER_USERNAME` / `SUPPLIER_PASSWORD` | *(secret)* | Credentials — **set as GitHub secrets only**. |
| `SUPPLIER_USER_SELECTOR` / `SUPPLIER_PASS_SELECTOR` / `SUPPLIER_SUBMIT_SELECTOR` | sensible defaults | Login form selectors. |
| `SUPPLIER_LOGIN_SUCCESS_SELECTOR` | *(empty)* | Optional element that confirms a successful login. |

The session (cookies/storage) is persisted to `sync/.state/session.json`, so login
runs once and subsequent nightly runs reuse it.

## Translation
| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSLATE_PROVIDER` | `anthropic` | `anthropic` or `none` (passthrough — no key, no translation). |
| `ANTHROPIC_API_KEY` | *(secret)* | Required for the `anthropic` provider. |
| `TRANSLATE_MODEL` | `claude-opus-4-8` | Translation model. |

Translation **preserves** brand names, model numbers, SKUs, part numbers, technical
spec values, measurements, numbers and units verbatim; only descriptive text is
translated. Results are cached in `sync/.state/translation-cache.json`.

## Images
| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_MAX_WIDTH` | `1600` | Downscale wider images to this width. |
| `IMAGE_WEBP_QUALITY` | `82` | WebP quality (high quality, web-optimized). |
| `IMAGE_KEEP_ORIGINAL` | *(unset)* | Set `1` to also keep the full-res original. |
| `IMAGE_MAX_PER_PRODUCT` | `8` | Cap images stored per product. |

All images are **downloaded locally** (never hotlinked) to `data/images/<category>/`.

## Output & site
| Variable | Default | Description |
|----------|---------|-------------|
| `SITE_BASE_URL` | `https://trendholic.github.io` | Used for absolute URLs in sitemap/search index. |
| `DRY_RUN` | *(unset)* | `1` = crawl + translate but write nothing. |
