/**
 * Foursquare Places proxy — Cloudflare Worker (free tier).
 *
 * Why: calling the Foursquare Places API directly from a browser can be blocked
 * by CORS, and it would expose your API key in the page source. This tiny proxy
 * solves both: it adds the CORS headers the browser needs, and it injects your
 * API key server-side (stored as an encrypted secret), so the key never leaves
 * Cloudflare.
 *
 * Setup (see PROXY-SETUP.md for the click-by-click version):
 *   1. Create a Worker at https://workers.cloudflare.com (free).
 *   2. Paste this file as the Worker code and Deploy.
 *   3. Add a Secret named  FSQ_KEY  = your Foursquare Service API key.
 *   4. (Optional) restrict ALLOW_ORIGIN below to your own site.
 *   5. Copy the Worker URL (e.g. https://fsq-proxy.you.workers.dev) and paste it
 *      into the dashboard's "🔑 Upgrade to verified data" panel.
 */

// Lock this to your site for safety, or keep "*" to allow any origin.
const ALLOW_ORIGIN = "*"; // e.g. "https://trendholic.github.io"

const FSQ_ENDPOINT = "https://places-api.foursquare.com/places/search";
const FSQ_API_VERSION = "2025-06-17";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return json({ error: "Use GET" }, 405);
    }
    if (!env.FSQ_KEY) {
      return json({ error: "Worker missing FSQ_KEY secret" }, 500);
    }

    // Forward the incoming query string (?ll=..&radius=..&limit=..&fields=..)
    // straight to Foursquare, adding auth + version headers server-side.
    const url = new URL(request.url);
    const target = FSQ_ENDPOINT + url.search;

    let resp;
    try {
      resp = await fetch(target, {
        headers: {
          Authorization: "Bearer " + env.FSQ_KEY,
          Accept: "application/json",
          "X-Places-Api-Version": FSQ_API_VERSION,
        },
      });
    } catch (e) {
      return json({ error: "Upstream fetch failed", detail: String(e) }, 502);
    }

    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}
