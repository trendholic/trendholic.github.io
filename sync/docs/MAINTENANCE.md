# Maintenance Guide

## Routine
The system is designed to run unattended nightly. Normal operation needs no
manual work. After each run, check `data/sync-log.json`:

```json
{ "added": 3, "updated": 12, "unchanged": 240, "removed": 1,
  "translationFailures": 0, "downloadFailures": 0, "crawlFailures": 0,
  "crawlStats": { "categories": 9, "productUrls": 256, "productsOk": 255 } }
```

Per-run detail (including every failure with its URL and reason) is in
`sync/logs/sync-<timestamp>.json`.

## When the supplier changes its HTML
Symptoms: `crawlFailures` spikes, or products log
`no product name extracted (adapter selectors may need calibration)`.

Fix — **edit one file**: `sync/src/adapters/tangma2088.js`.
1. Open a real category page and a real product page in a browser.
2. Update the `SELECTORS` object to match the new DOM.
3. Verify: `MAX_PRODUCTS_PER_CATEGORY=2 TRANSLATE_PROVIDER=none npm run sync:dry`.
4. Commit. No other file should need changes.

Adding a **new supplier** = add one `adapters/<name>.js` (copy `tangma2088.js`)
and register it in `adapters/index.js`.

## Incremental sync
Change detection uses a stable key (SKU, else source URL) + a content hash of the
raw extraction stored in `sync/.state/state.json`. Unchanged products are reused
from `data/products/*.json` without re-translating or re-downloading — so nightly
runs are fast and cheap. To force a full rebuild, delete `sync/.state/state.json`
(and optionally `translation-cache.json`) and re-run.

## Safe deletions
A product is removed from the site only if it was present before **and** its
category crawled successfully this run. If a category fails to load, its products
are preserved — a supplier outage can never wipe the catalog.

## Cloudflare / anti-bot
If pages start returning challenge HTML, set `RENDER_MODE=always` and ensure
Playwright Chromium is installed (`npx playwright install --with-deps chromium`).
The browser persists its session in `sync/.state/session.json`. If the supplier
requires login, set `SUPPLIER_LOGIN_URL` + `SUPPLIER_USERNAME`/`SUPPLIER_PASSWORD`
(as GitHub secrets). Delete `session.json` to force a fresh login.

## Deploy gate
The workflow runs `npm run validate` after the sync; if catalog JSON, the search
index, or the sitemap are malformed, the commit + Pages deploy is **blocked**.
Investigate the validation output, fix the adapter/config, and re-run
(`Actions → Nightly Product Sync → Run workflow`).

## Costs
Translation calls the Anthropic API only for **new or changed** text (cached
otherwise). A steady-state nightly run with few changes costs very little.

## Rolling back
Every run is a single clean commit touching only `data/`, `sitemap.xml`,
`robots.txt`, and sync state. To roll back a bad sync: `git revert <commit>`.
Retail files are never part of a sync commit.
