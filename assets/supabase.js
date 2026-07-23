// Shared Supabase client for the wholesale portal (dealer + admin).
// Reads PUBLIC config from window.TRENDHOLIC_CONFIG (assets/config.js).
// Only the public anon key is used here; RLS enforces all access server-side.
//
// When config is absent (development), we fall back to a harmless placeholder
// so importing this module never throws — pages independently gate real calls
// behind hasConfig() and render a clear "not connected" state instead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.TRENDHOLIC_CONFIG || {};
const url = cfg.SUPABASE_URL || "https://placeholder.supabase.co";
const key = cfg.SUPABASE_ANON_KEY || "public-anon-placeholder";

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
