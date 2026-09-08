# Private product import

This extends the existing Node sync and static catalog; it does not replace the website.

## Architecture and boundaries

The admin runs on `http://127.0.0.1:8788`, bound only to loopback. Every page, API, and preview image requires HTTP authentication (`admin` plus a random password). Host validation, same-origin POST checks, bounded input, and a restrictive CSP protect this local interface. Do not expose this HTTP service to a network or tunnel it.

The public GitHub Pages site cannot run a secret-bearing import server. Source URLs, supplier identifiers, acquisition data, exchange rates, costs, audits, and cached original images live in `IMPORT_PRIVATE_DIR`, which must be outside the repository. Use a directory accessible only to your operating-system account; on Windows, enforce this with NTFS permissions. Back up this directory privately: it holds the source identity deduplication history. Never put source URLs into public GitHub issues, workflow inputs, commit messages, or artifacts.

The new pipeline never writes private state to `sync/.state`, `sync/logs`, or public `data/`. The legacy sync already stores provenance publicly; this feature does **not** retroactively remove that data or rewrite repository history. Existing catalog records are preserved. A separate migration would be needed to remove historical provenance from existing products.

## First real import

1. Install Node 20+ and run `npm ci` in `sync`.
2. Supply environment variables to the Node process through your secure local credential mechanism. No keys belong in this repository or browser code.

| Variable | Required value |
|---|---|
| `IMPORT_PRIVATE_DIR` | Absolute private directory outside the repository |
| `IMPORT_ADMIN_TOKEN` | Random password of at least 32 characters |
| `IMPORT_SOURCE_ENDPOINT` | Authorized acquisition service HTTPS endpoint implementing the contract below |
| `IMPORT_SOURCE_TOKEN` | Its bearer token |
| `ANTHROPIC_API_KEY` | Anthropic API credential |
| `IMPORT_TRANSLATE_MODEL` | A model available to your account supporting text and vision |
| `IMPORT_FX_USD_PER_CNY` | Current USD received for one CNY, decimal string |
| `IMPORT_FX_DATE` | Quotation timestamp in ISO 8601 format, no older than seven days |
| `IMPORT_FX_SOURCE` | Exchange-rate quotation source/reference |
| `IMPORT_ROUNDING` | `retail99` (default) or `exact` |
| `IMPORT_IMAGE_HOSTS` | Optional comma-separated exact allowed image hosts; defaults to cbu01–04.alicdn.com |
| `IMPORT_IMAGE_EDIT_ENDPOINT` / `IMPORT_IMAGE_EDIT_TOKEN` | Optional authorized image-localization service |

3. Ensure the checkout contains the existing `data/catalog/_index.json`, `data/search-index.json`, and original source product directories. A full checkout is needed for production build validation, including existing image files.
4. Run `npm run import:admin`; open `http://127.0.0.1:8788`. Username: `admin`. Password: the value of `IMPORT_ADMIN_TOKEN`.
5. Paste a real product URL and click **Import Product**. No product fields need to be entered manually.
6. Review READY copy, selected options, prices, and every image. **Approve & Export to Catalog** exports the public record and sanitized images. It cannot override failed validation. Failed or uncertain imports can be retried after correcting the service/source/configuration.
7. Run `npm test`, `npm run check`, `npm run build:catalog`, and `npm run validate`. Review and commit only the public exports and generated catalog files. Push through the existing GitHub Pages deployment. This local export button does not itself push Git commits or claim that the product is already live.

## Acquisition adapter contract

No scraper, session bypass, or invented product is used. Configure an acquisition method you are authorized to use. The importer POSTs JSON `{url, offerId}` to the configured fixed HTTPS endpoint using `Authorization: Bearer ...`. The adapter must return HTTP 200 with:

```json
{
  "offerId": "matching offer ID as a string",
  "title": "original product title",
  "description": "original useful description",
  "currency": "CNY",
  "costCny": "verified single-unit cost as a decimal string",
  "priceBasis": "single-unit",
  "images": ["https://allowed-image-host/path.jpg"],
  "specifications": {},
  "features": [],
  "packageContents": [],
  "variants": [],
  "supplierName": "internal only",
  "supplierIdentifiers": ["additional names, contacts, or internal identifiers to block"]
}
```

Each variant is `{id,costCny,options:[{name,value}]}`. IDs and option order must be stable. Return only actual single-product variants. Price tiers, ranges, minimum quantities, and ambiguous bundle pricing must be resolved by the acquisition adapter to the actual sellable unit; unresolved prices are held for review. The importer never selects an arbitrary low price from a range.

Redirects, private/reserved network targets, arbitrary ports and credentials in URLs are rejected. Image requests use an exact host allowlist. DNS addresses are checked and pinned for the request. Response bytes, timeouts, attempts and image pixels are bounded. Permanent HTTP errors are not retried; transient errors get at most three attempts.

## Translation, categories, and images

The Anthropic Messages API creates concise English copy, translates variant labels without changing their relationships, and recommends a category using the complete source facts. A separate model call audits the copy against the original. Deterministic validation blocks Chinese text, sourcing language, contacts, known supplier identifiers, long titles, malformed options, and invalid prices. This is an automated screening layer, not proof that a model cannot make mistakes: administrator review is required before export.

Existing top-level categories are reused; normalized aliases handle Kitchen Storage / Kitchen Organizers / Kitchen Organization. A distinct, justified category can be added. New records merge into existing category collections in the current catalog generator. Source ID deduplication is private; title and processed-image hashes provide additional checks. Title matching is normalized, not a semantic guarantee of duplicate detection.

Images are downloaded privately, decoded with Sharp, bounded to 24 megapixels, checked for at least 300×300 pixels, and re-encoded to WebP without metadata. Vision inspection checks relevance, Chinese text, branding, QR codes, contacts, watermarks, and readability. Exact duplicate bytes/processed images are discarded. This is not a perceptual duplicate detector.

Useful Chinese text can be sent to the optional editing endpoint as `{imageBase64,mimeType,text,translation,instruction}`. It must return `{imageBase64}`. The edited image is decoded again, re-inspected, and compared against the original. No watermark-removal operation is requested. Unsafe images are excluded; unavailable essential localization holds the product for review. Clean images are not sent to the editor. No image-editing service is bundled or provisioned by this change.

API format reference: [Anthropic Messages and vision documentation](https://platform.claude.com/docs/en/build-with-claude/working-with-messages).

## Pricing

`USD cost = CNY cost × USD-per-CNY rate`; `calculated price = USD cost × 2` (100% markup, 50% gross margin before expenses). Rational arithmetic avoids intermediate currency rounding. Exact mode rounds this final calculation to the nearest USD cent, half up. Retail mode rounds upward to the next price ending in `.99`, retaining an already-exact `.99`. Thus $13.72 → $13.99, $24.18 → $24.99, and $14.00 → $14.99. Retail rounding changes the realized markup; the unrounded calculation and policy are retained privately. Choose `exact` for the closest cent-denominated 2× price. Variant prices are calculated separately.

## Operations and limitations

One admin process owns the private directory; a lock prevents concurrent writers. After an unclean stop, verify the recorded process is no longer running before removing `server.lock`. Interrupted imports become NEEDS REVIEW on restart. Cache data stays private. If correcting a model/service behavior, stop the admin and clear its private cache before retrying to force reprocessing. Do not delete the job history when clearing the cache.

The export writes assets before atomically replacing the public manifest. Existing products are never overwritten. The nightly build consumes this manifest independently of source crawling. No acquisition calls execute on customer page loads.

Automated tests use explicit synthetic provider fixtures; they do not establish live 1688 access or real translation/image-edit quality. Live A–L acceptance needs the acquisition account, translation credentials, optional image service, and real product URLs. Missing configuration fails safely. The supplied repository had no configured import acquisition endpoint or local API credentials at implementation time.

Changed components: `src/import/` (validation, providers, pipeline, private admin, public catalog adapter, tests); `src/build-catalog.js` (additive import merge and variant cart handling); `scripts/validate.js` (public import checks); `scripts/check-import.js`; package scripts; CI checks. Existing retail files and source data are unchanged.
