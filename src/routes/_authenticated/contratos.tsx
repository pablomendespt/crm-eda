import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/contratos")({
  component: Contratos,
});

function Contratos() {
  const { data: members = [] } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const memberNames = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m.nome])),
    [members],
  );

  const { data } = useQuery({
    queryKey: ["vendas", "contratos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("vendas")
        .select("*")
        .eq("status", "ativo")
        .order("data", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Contratos</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Documentos vinculados às vendas ativas.</p>
      </div>
      <div className="eda-card">
        <table className="w-full text-sm">
          <thead><tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase"><th className="py-2">Data</th><th>Cliente</th><th>Closer</th><th>Email</th><th className="text-right">Valor</th></tr></thead>
          <tbody>
            {data?.map((v) => (
              <tr key={v.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2.5">{fmtDate(v.data)}</td>
                <td className="font-medium">{v.nome_cliente}</td>
                <td style={{ color: "var(--text2)" }}>{(v.closer_id && memberNames[v.closer_id]) || "—"}</td>
                <td style={{ color: "var(--text3)" }}>{v.email ?? "—"}</td>
                <td className="text-right font-semibold">{eur(Number(v.ticket))}</td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={5} className="py-6 text-center" style={{ color: "var(--text3)" }}>Sem contratos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
