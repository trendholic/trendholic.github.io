// sync-products — one-way import of retail catalog metadata (SKU, name, brand,
// image, retail price) from the public Google Sheet CSV into public.products.
// NEVER writes wholesale columns. New SKUs arrive is_active=true but remain
// wholesale-ineligible until an admin opts them in. The retail site is
// untouched — it keeps reading the Sheet directly.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEBHOOK_SECRET, SHEET_CSV_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHEET = Deno.env.get("SHEET_CSV_URL")!;

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals: string[] = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { vals.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (vals[i] ?? "").replace(/^"|"$/g, "")));
    return row;
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const csv = await fetch(SHEET).then((r) => r.text());
  const rows = parseCsv(csv);

  let upserted = 0;
  for (const r of rows) {
    const sku = r["id"] || r["sku"];
    if (!sku) continue;
    const retailCents = r["price"] ? Math.round(parseFloat(r["price"]) * 100) : null;
    // Upsert ONLY retail metadata columns; wholesale columns are never touched.
    const { error } = await admin.from("products").upsert({
      sku,
      name: r["name"] ?? null,
      brand: r["brand"] ?? null,
      gender: r["gender"] ?? null,
      ml: r["ml"] ?? null,
      image_path: r["img"] ?? null,
      notes: r["notes"] ?? null,
      retail_price_cents: retailCents,
      source: "google_sheet",
      external_ref: sku,
      updated_at: new Date().toISOString(),
    }, { onConflict: "sku" });
    if (!error) upserted++;
  }
  return new Response(JSON.stringify({ ok: true, upserted }), {
    headers: { "Content-Type": "application/json" },
  });
});
