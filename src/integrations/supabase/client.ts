import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://htiicujsscbzjteuozwd.supabase.co";
const SUPABASE_KEY = "sb_publishable_PnkiMC7BuOFvNjflAXN5QA_zw1wyEhk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: typeof window !== "undefined" ? window.localStorage : undefined, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
