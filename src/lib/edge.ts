import { supabase } from "@/integrations/supabase/client";

// Chama uma Edge Function do Supabase e devolve o JSON; lança Error com a mensagem do servidor.
export async function callEdge<T = any>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch { /* mantém a mensagem original */ }
    throw new Error(msg);
  }
  return data as T;
}
