// Shared Supabase client for the wholesale portal (dealer + admin).
// Reads PUBLIC config from window.TRENDHOLIC_CONFIG (assets/config.js).
// Only the public anon key is used here; RLS enforces all access server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.TRENDHOLIC_CONFIG || {};
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  console.error("Missing assets/config.js — copy assets/config.example.js.");
}

export const supabase = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
