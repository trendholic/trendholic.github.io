// Client-side route guards. These are CONVENIENCE redirects only — the real
// enforcement is RLS in the database. A guard failure never exposes data
// because every query is independently gated server-side.
import { supabase } from "./supabase.js";

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// Redirect to login if not authenticated. Returns the user or null.
export async function requireAuth(loginUrl) {
  const s = await currentSession();
  if (!s) { window.location.replace(loginUrl); return null; }
  return s.user;
}

// Require an APPROVED dealer. Non-approved dealers go to the status page.
export async function requireApprovedDealer() {
  const user = await requireAuth("/dealer/login.html");
  if (!user) return null;
  const { data } = await supabase.from("dealers").select("status,tier_id").eq("id", user.id).maybeSingle();
  if (!data || data.status !== "approved") {
    window.location.replace("/dealer/status.html");
    return null;
  }
  return { user, dealer: data };
}

// Require an active admin (database-backed; never a client role claim).
export async function requireAdmin() {
  const user = await requireAuth("/admin/login.html");
  if (!user) return null;
  const { data } = await supabase.from("admin_users").select("id").eq("id", user.id).eq("is_active", true).maybeSingle();
  if (!data) { window.location.replace("/admin/login.html"); return null; }
  return user;
}

export async function signOut(redirect) {
  await supabase.auth.signOut();
  window.location.replace(redirect || "/index.html");
}
