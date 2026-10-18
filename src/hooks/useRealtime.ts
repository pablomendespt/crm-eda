import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Todas as tabelas relevantes ao CRM. Qualquer mudança aqui reflete-se em
// todos os acessos abertos (SDR, Closer, Fundadores) sem precisar refresh.
const TABLES = [
  "vendas",
  "leads",
  "noshows",
  "cobrancas",
  "daily_stats",
  "members",
  "sdr_daily",
  "closer_daily",
  "follow_ups",
  "calls",
  "metas_config",
  "recovery_leads",
  "recovery_interactions",
  "leads_consolidados",
];

export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`eda-crm-sync-${Math.random().toString(36).slice(2)}`);
      TABLES.forEach((table) => {
        if (!channel) return;
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => {
            if (cancelled) return;
            qc.invalidateQueries({ queryKey: [table] });
            if (["vendas", "cobrancas", "members", "metas_config"].includes(table)) {
              qc.invalidateQueries({ queryKey: ["finance"] });
              qc.invalidateQueries({ queryKey: ["pag"] });
              qc.invalidateQueries({ queryKey: ["metas_mensais_equipa"] });
            }
            if (table === "vendas") {
              qc.invalidateQueries({ queryKey: ["dashboard-vendas"] });
              qc.invalidateQueries({ queryKey: ["vendas-dia-closer"] });
              qc.invalidateQueries({ queryKey: ["visao-geral"] });
            }
          },
        );
      });
      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[realtime] canal com problema:", status);
        }
      });
    } catch (err) {
      // Nunca deixar o realtime derrubar a app — logamos e seguimos.
      console.warn("[realtime] falhou a arrancar:", err);
    }
    return () => {
      cancelled = true;
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, [qc]);
}


