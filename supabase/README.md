# TrendHolic Wholesale — Backend (Supabase)

Phase 1 backend for the Admin + Dealer wholesale system. The retail storefront
(`index.html`, `cart.html`, `db.js`, Google Sheets, Facebook Pixel, images,
`store-finder`) is **not** part of this and is untouched.

## Security model (approved Design 1)
- **Reads**: plain declarative RLS on the price tables (no bypass views).
- **Writes**: a single `SECURITY DEFINER` RPC `place_wholesale_order` is the only
  order-write path; it recomputes price, MOQ, and totals server-side.
- RLS is enabled + **forced** on every table as an always-on backstop.
- All money is stored as **integer cents**; order totals are `bigint`.
- Order line snapshots and the admin audit log are **immutable** (triggers).

## Migration order
Run in numeric order (`001` → `013`). `013_assertions.sql` fails the migration
if a critical invariant (RLS forced, pinned `search_path`, no leaked price
columns, resolvers not client-executable) is missing.

```
supabase link --project-ref <your-ref>
supabase db push          # applies supabase/migrations/*.sql in order
```

## Edge Functions
```
supabase functions deploy send-email
supabase functions deploy sign-document-url
supabase functions deploy sync-products
```

### Secrets — set these in the Supabase dashboard (never in the repo/browser)
| Secret | Used by |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | sign-document-url, sync-products |
| `RESEND_API_KEY`, `RESEND_FROM` | send-email |
| `WEBHOOK_SECRET` | send-email, sync-products |
| `ADMIN_NOTIFY_EMAILS` | send-email |
| `SHEET_CSV_URL` | sync-products |

The **only** values the frontend needs are the Project URL and public `anon`
key, placed in `assets/config.js` (copied from `assets/config.example.js`).

## Provisioning admins
Create each admin as a Supabase Auth user, then insert an `admin_users` row with
their `id` and `email` (`is_active = true`). There is no admin sign-up form.

## Storage
Private bucket `dealer-docs` (created by `012`). Dealers read/write only their
own `dealer-docs/{uid}/...` prefix; admins view via short-TTL signed URLs from
the `sign-document-url` function. No document is ever publicly accessible.
