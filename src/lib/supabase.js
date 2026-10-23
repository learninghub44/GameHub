import { createClient } from "@supabase/supabase-js";

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = import.meta.env;
export const isSupabaseConfigured = Boolean(VITE_SUPABASE_URL && VITE_SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
