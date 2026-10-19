import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/audit-log")({
  component: AuditLogPage,
});

type Row = {
  id: string;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor_id: string | null;
  actor_member_id: string | null;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
};

const TABLES = ["all", "leads_consolidados", "leads", "noshows", "vendas"] as const;
const ACTIONS = ["all", "INSERT", "UPDATE", "DELETE"] as const;

function AuditLogPage() {
  const { data: profile } = useProfile();
  if (profile && profile.role !== "socio") return <Navigate to="/funil" replace />;

  const [table, setTable] = useState<(typeof TABLES)[number]>("all");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("all");
  const [limit, setLimit] = useState(100);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["audit_log", table, action, limit],
    queryFn: async () => {
      let q = supabase
        .from("audit_log" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (table !== "all") q = q.eq("table_name", table);
      if (action !== "all") q = q.eq("action", action);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const { data: members } = useQuery({
    queryKey: ["members-directory-audit"],
    queryFn: async () => {
      const { data } = await supabase.from("members").select("id, nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const memberName = useMemo(() => {
    const m = new Map<string, string>();
    (members ?? []).forEach((x) => m.set(x.id, x.nome));
    return m;
  }, [members]);

  const badge = (a: Row["action"]) => {
    const color =
      a === "INSERT" ? "var(--green)" : a === "UPDATE" ? "var(--accent)" : "#f87171";
    return (
      <span
        className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase"
        style={{ background: `${color}22`, color }}
      >
        {a}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Histórico de Alterações</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          Registo de tudo o que foi criado, editado ou eliminado em leads, "Não Compareceu" e vendas.
        </p>
      </div>

      <div className="eda-card flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>
            Tabela
          </label>
          <select className="eda-input" value={table} onChange={(e) => setTable(e.target.value as never)}>
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "Todas" : t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>
            Acção
          </label>
          <select className="eda-input" value={action} onChange={(e) => setAction(e.target.value as never)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "all" ? "Todas" : a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>
            Limite
          </label>
          <select className="eda-input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="eda-card overflow-x-auto">
        {isLoading ? (
          <div className="text-sm">A carregar...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
                <th className="py-2">Quando</th>
                <th className="py-2">Tabela</th>
                <th className="py-2">Acção</th>
                <th className="py-2">Autor</th>
                <th className="py-2">Registo</th>
                <th className="py-2">Campos alterados</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="py-2 whitespace-nowrap" style={{ color: "var(--text2)" }}>
                        {new Date(r.created_at).toLocaleString("pt-PT")}
                      </td>
                      <td className="py-2 font-mono text-xs">{r.table_name}</td>
                      <td className="py-2">{badge(r.action)}</td>
                      <td className="py-2">
                        {r.actor_member_id ? memberName.get(r.actor_member_id) ?? "—" : "—"}
                      </td>
                      <td className="py-2 font-mono text-[10px]" style={{ color: "var(--text3)" }}>
                        {r.record_id.slice(0, 8)}
                      </td>
                      <td className="py-2 text-xs" style={{ color: "var(--text2)" }}>
                        {r.changed_fields?.length ? r.changed_fields.join(", ") : "—"}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          className="eda-btn-ghost text-xs"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                        >
                          {isOpen ? "Fechar" : "Ver"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: "var(--surface2)" }}>
                        <td colSpan={7} className="py-3 px-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div>
                              <div className="font-bold mb-1" style={{ color: "var(--text2)" }}>
                                Antes
                              </div>
                              <pre className="whitespace-pre-wrap break-all" style={{ color: "var(--text3)" }}>
                                {r.old_values ? JSON.stringify(r.old_values, null, 2) : "—"}
                              </pre>
                            </div>
                            <div>
                              <div className="font-bold mb-1" style={{ color: "var(--text2)" }}>
                                Depois
                              </div>
                              <pre className="whitespace-pre-wrap break-all" style={{ color: "var(--text3)" }}>
                                {r.new_values ? JSON.stringify(r.new_values, null, 2) : "—"}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {(rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center" style={{ color: "var(--text2)" }}>
                    Sem registos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
