import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const CRITICAL_TABLES = [
  "profiles",
  "members",
  "user_roles",
  "vendas",
  "leads",
  "noshows",
  "cobrancas",
  "daily_stats",
] as const;

const RESET_KEY = "eda_health_reset_at";
const RESET_COOLDOWN_MS = 30_000;

export type HealthStatus = "checking" | "ok" | "failed";

async function probeTable(name: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(name as never)
      .select("*", { count: "exact", head: true })
      .limit(1);
    if (!error) return true;
    // Só consideramos falha real quando a tabela não existe no schema.
    // Erros de permissão (RLS), sessão ou rede são transitórios e não devem
    // marcar a base de dados como inacessível.
    const msg = (error.message || "").toLowerCase();
    const code = String((error as { code?: string }).code ?? "");
    const missing =
      code === "42P01" ||
      code === "PGRST205" ||
      msg.includes("does not exist") ||
      msg.includes("schema cache");
    return !missing;
  } catch {
    // Falha de rede — não é motivo para limpar caches nem recarregar.
    return true;
  }
}

async function resetAppState() {
  try {
    if (typeof window === "undefined") return;
    const last = Number(localStorage.getItem(RESET_KEY) || 0);
    if (Date.now() - last < RESET_COOLDOWN_MS) return; // avoid reload loops
    const now = Date.now();

    // Clear app caches but preserve Supabase auth session, preferências do
    // utilizador e o marcador de cooldown (senão entrávamos em loop de reload).
    const preserve: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("sb-") || k.startsWith("eda:"))) {
        preserve[k] = localStorage.getItem(k) || "";
      }
    }
    localStorage.clear();
    for (const [k, v] of Object.entries(preserve)) localStorage.setItem(k, v);
    localStorage.setItem(RESET_KEY, String(now));
    sessionStorage.clear();

    window.location.reload();
  } catch {
    // ignore
  }
}

export function useHealthCheck() {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [failedTables, setFailedTables] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        CRITICAL_TABLES.map(async (t) => ({ t, ok: await probeTable(t) })),
      );
      if (cancelled) return;
      const failed = results.filter((r) => !r.ok).map((r) => r.t);
      if (failed.length === 0) {
        setStatus("ok");
        return;
      }
      setFailedTables(failed);
      setStatus("failed");
      // Auto-reset once per cooldown window.
      await resetAppState();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, failedTables };
}
