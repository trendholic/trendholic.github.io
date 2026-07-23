// sign-document-url — mint a short-TTL signed URL for a private dealer document.
// ADMIN ONLY. Verifies the caller's JWT, confirms they are an active admin via
// the service-role client, then signs a URL in the private 'dealer-docs' bucket.
// service_role key stays server-side; documents are never publicly accessible.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy with default JWT verification ON (this function reads the caller JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TTL_SECONDS = 60;

// Browser (admin pages) calls this cross-origin via functions.invoke, so we
// must answer the CORS preflight and echo CORS headers on every response.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Identify the caller from their JWT.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  // Confirm active admin (database-backed authorization, not a client claim).
  const { data: adminRow } = await admin
    .from("admin_users").select("id").eq("id", userData.user.id)
    .eq("is_active", true).maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  const { path } = await req.json().catch(() => ({}));
  if (!path) return json({ error: "missing path" }, 400);

  const { data, error } = await admin.storage
    .from("dealer-docs").createSignedUrl(path, TTL_SECONDS);
  if (error) return json({ error: error.message }, 400);

  return json({ url: data.signedUrl, expires_in: TTL_SECONDS });
});
