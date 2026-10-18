import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vuqbuuvtcxiongzhwtqz.supabase.co";
const SUPABASE_KEY = "sb_publishable_rNDTVfablrXdmLoaoTSPcw_cIyLmqf5";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: typeof window !== "undefined" ? window.localStorage : undefined, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
