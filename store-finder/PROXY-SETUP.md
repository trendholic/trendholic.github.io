# Fast & reliable verified data — 5-minute proxy setup

This sets up a **free Cloudflare Worker** that lets the dashboard pull fast,
verified Foursquare data in the browser **without CORS errors** and **without
exposing your API key** (the key is stored encrypted on Cloudflare).

You do this once. It's free (Cloudflare's free tier covers ~100k requests/day).

---

## Step 1 — Get a free Foursquare API key (no credit card)

1. Go to <https://foursquare.com/developers/> and sign up / log in.
2. Create a **Project**.
3. Inside the project, create a **Service API Key** and copy it.

## Step 2 — Create the Cloudflare Worker

1. Go to <https://workers.cloudflare.com> and sign up (free).
2. **Create application → Create Worker.** Give it a name, e.g. `fsq-proxy`.
3. Click **Deploy**, then **Edit code**.
4. Delete the sample code and paste the entire contents of
   [`foursquare-proxy.worker.js`](./foursquare-proxy.worker.js).
5. Click **Deploy**.

## Step 3 — Add your key as a secret

1. In the Worker, open **Settings → Variables and Secrets**
   (or **Settings → Variables**).
2. Under **Secrets**, **Add**:
   - **Name:** `FSQ_KEY`
   - **Value:** your Foursquare Service API key from Step 1
3. **Save / Deploy.**

> Storing it as a *Secret* (not a plain variable) keeps it encrypted and out of
> logs.

## Step 4 — (Recommended) lock it to your site

In the Worker code, change:

```js
const ALLOW_ORIGIN = "*";
```

to

```js
const ALLOW_ORIGIN = "https://trendholic.github.io";
```

and Deploy again. This stops other sites from using your proxy.

## Step 5 — Connect it to the dashboard

1. Copy your Worker URL (looks like `https://fsq-proxy.YOURNAME.workers.dev`).
2. Open the dashboard → **🔑 Upgrade to verified data** panel.
3. Paste the URL into **Proxy URL**, click **Save & use**.
4. Search — the status line should read **source: Foursquare (verified)** and
   cards will show ⭐ ratings.

---

## Troubleshooting

- **Still says OpenStreetMap / no ratings:** double-check the Worker URL is
  correct and that `FSQ_KEY` secret is set. Open the Worker URL directly in a
  browser with `?ll=40.71,-74.0&radius=2000&limit=5&fields=name` appended — you
  should see JSON, not an error.
- **`Worker missing FSQ_KEY secret`:** the secret wasn't saved; redo Step 3.
- **403 from Foursquare:** the API key is wrong or the project isn't active.
- The dashboard **always falls back to free OpenStreetMap** if the proxy is
  unreachable, so it never breaks.
