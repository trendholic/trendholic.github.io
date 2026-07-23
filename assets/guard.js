// guard.js — auth/role/status guards. CONVENIENCE redirects only; the real
// enforcement is RLS in the database. A guard failure never exposes data
// because every query is independently gated server-side.
import { supabase } from "./supabase.js";

export async function currentSession(){
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function requireAuth(loginUrl){
  const s = await currentSession();
  if(!s){ window.location.replace(loginUrl); return null; }
  return s.user;
}

// Returns {dealer|null, application|null} for the current user.
export async function getDealerState(userId){
  const { data: dealer } = await supabase
    .from("dealers").select("status,tier_id,business_name").eq("id", userId).maybeSingle();
  const { data: apps } = await supabase
    .from("dealer_applications").select("status,submitted_at")
    .eq("applicant_user_id", userId).order("submitted_at",{ascending:false}).limit(1);
  return { dealer: dealer || null, application: (apps && apps[0]) || null };
}

// Require an APPROVED dealer. Non-approved -> application status page.
export async function requireApprovedDealer(){
  const user = await requireAuth("/dealer/login.html");
  if(!user) return null;
  const { data } = await supabase.from("dealers")
    .select("status,tier_id,business_name").eq("id", user.id).maybeSingle();
  if(!data || data.status !== "approved"){
    window.location.replace("/dealer/application-status.html");
    return null;
  }
  return { user, dealer: data };
}

// Decide where a dealer goes right after login.
export async function routeDealerAfterLogin(user){
  const { dealer } = await getDealerState(user.id);
  if(dealer && dealer.status === "approved") window.location.replace("/dealer/dashboard.html");
  else window.location.replace("/dealer/application-status.html");
}

// Require an active admin (database-backed; never a client role claim).
export async function requireAdmin(){
  const user = await requireAuth("/admin/login.html");
  if(!user) return null;
  const { data } = await supabase.from("admin_users")
    .select("id,name,email").eq("id", user.id).eq("is_active", true).maybeSingle();
  if(!data){ await supabase.auth.signOut(); window.location.replace("/admin/login.html"); return null; }
  return { user, admin: data };
}

export async function signOut(redirect){
  await supabase.auth.signOut();
  window.location.replace(redirect || "/index.html");
}
