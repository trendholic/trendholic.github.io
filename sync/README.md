# TrendHolic Product Sync

Nightly pipeline that imports the supplier catalog into this repository as clean,
translated, SEO-ready JSON + optimized images — **fully additive**. It never
modifies the retail storefront (`index.html`, `cart.html`, `db.js`, `app.js`,
`style.css`, `products.json`, `images/`, `store-finder/`) and never changes its
design.

```
Supplier site ──crawl──> extract ──translate(EN)──> images(webp) ──> JSON DB
                                                          │
                          sitemap.xml  <── search-index ──┴──> /data  ──> (optional) /catalog viewer
```

## What it does (maps to the requirements)
Crawl every category · preserve hierarchy · extract name/SKU/brand/description/
specs/features/images/PDFs/variations/model/technical data · translate to
professional American English (brand + model numbers preserved) · de-duplicate ·
SEO image filenames · per-category JSON · upsert (no dupes) · new products auto-
placed in their category · deleted products removed (safely, per crawled
category only) · nightly GitHub Action · clean commits with an update log · SEO
metadata (title/description/keywords/slug/alt) · web image compression · auto
`sitemap.xml` · regenerated search index · failures logged and skipped · all data
stored in-repo.

## Install
```bash
cd sync
npm install
# optional (only if the supplier needs JS rendering / anti-bot):
npx playwright install --with-deps chromium
```

## Configure (environment variables — no secrets in code)
| Var | Default | Purpose |
|-----|---------|---------|
| `SOURCE_BASE_URL` | `https://macc.tangma2088.com` | supplier root |
| `SEED_CATEGORIES` | *(empty)* | comma-separated category URLs (recommended once known) |
| `RENDER_MODE` | `auto` | `auto` \| `always` \| `never` (headless rendering) |
| `TRANSLATE_PROVIDER` | `anthropic` | `anthropic` \| `none` |
| `ANTHROPIC_API_KEY` | *(secret)* | required if provider = `anthropic` |
| `CRAWL_CONCURRENCY` / `CRAWL_MIN_DELAY_MS` | `3` / `1500` | politeness |
| `MAX_PRODUCTS_PER_CATEGORY` | `0` | `0` = no limit (use a small number to test) |
| `IGNORE_ROBOTS` | *(unset)* | leave unset to respect robots.txt |

## Run
```bash
npm run sync         # full sync
npm run sync:dry     # crawl + translate, write nothing (safe preview)
# focused test:
MAX_PRODUCTS_PER_CATEGORY=2 TRANSLATE_PROVIDER=none npm run sync:dry
```

## ★ Calibrate the adapter (required once)
Because the supplier returned **HTTP 503** to inspection, the CSS selectors in
`src/adapter.js` are best-effort generics (it also auto-uses schema.org JSON-LD
and OpenGraph when present). Open one real **category** page and one **product**
page, then update the `SELECTORS` object in `src/adapter.js`. Verify with the
focused test above before enabling the nightly job. **This is the only file that
should need site-specific changes.**

## Nightly automation (GitHub Actions)
`.github/workflows/product-sync.yml` runs at 03:00 UTC and on manual dispatch.
Configure in the repo settings:
- **Secret:** `ANTHROPIC_API_KEY`
- **Variables:** `SEED_CATEGORIES`, `RENDER_MODE`, `TRANSLATE_PROVIDER` (optional)

It stages only `data/`, `sitemap.xml`, and sync state/logs, then commits with a
message like `chore(sync): nightly catalog update — +12 ~3 -1 (0 fail)`.
GitHub runs scheduled workflows only from the **default branch**, so it activates
once this branch is merged.

## Output layout (all generated, additive)
```
data/
  catalog/_index.json          # list of categories
  catalog/<category>.json      # products in that category
  products/<slug>.json         # one file per product
  images/<category>/<slug>-N.webp
  manuals/<category>/<slug>-manual-N.pdf
  search-index.json
  sync-log.json                # last run: added/updated/removed/failures
sitemap.xml                    # repo root
sync/.state/state.json         # diff state (added/updated/removed detection)
sync/logs/sync-<ts>.json       # per-run failure log
catalog/index.html             # optional standalone viewer (new path)
```

## Safety & good-citizen notes
- Respects `robots.txt`, rate-limits (≥1.5s/request), sends an identifying UA.
- **You are responsible** for confirming you have the right to republish the
  supplier's images, PDFs and copy before enabling the nightly run.
- Deletions apply **only** within categories that crawled successfully, so a
  partial failure can never wipe the catalog.
- Translation failures keep the original text (never lose data).

## Not included by design
Wiring these products into the **existing** retail homepage would change that
page. Per the project's additive rule, that is a separate, approval-gated step.
The optional `/catalog/` viewer surfaces the data at a new path without touching
the retail design.
