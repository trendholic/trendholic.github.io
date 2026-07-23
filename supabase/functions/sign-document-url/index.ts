// sign-document-url — mint a short-TTL signed URL for a private dealer document.
// ADMIN ONLY. Verifies the caller's JWT, confirms they are an active admin via
// the service-role client, then signs a URL in the private 'dealer-docs' bucket.
// service_role key stays server-side; documents are never publicly accessible.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TTL_SECONDS = 60;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!jwt) return new Response("unauthorized", { status: 401 });

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Identify the caller from their JWT.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return new Response("unauthorized", { status: 401 });

  // Confirm active admin (database-backed authorization, not a client claim).
  const { data: adminRow } = await admin
    .from("admin_users").select("id").eq("id", userData.user.id)
    .eq("is_active", true).maybeSingle();
  if (!adminRow) return new Response("forbidden", { status: 403 });

  const { path } = await req.json().catch(() => ({}));
  if (!path) return new Response("missing path", { status: 400 });

  const { data, error } = await admin.storage
    .from("dealer-docs").createSignedUrl(path, TTL_SECONDS);
  if (error) return new Response(error.message, { status: 400 });

  return new Response(JSON.stringify({ url: data.signedUrl, expires_in: TTL_SECONDS }), {
    headers: { "Content-Type": "application/json" },
  });
});
