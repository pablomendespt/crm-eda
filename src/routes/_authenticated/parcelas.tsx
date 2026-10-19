import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { pageMeta } from "@/lib/page-meta";
import { monthRange } from "@/lib/period";
import { todayISO } from "@/lib/format";
import { useProfile } from "@/hooks/useAuth";
import { Msg } from "@/lib/pagamentos-ui";
import { Parcelas } from "@/components/Parcelas";

export const Route = createFileRoute("/_authenticated/parcelas")({
  head: () => pageMeta("Parcelas — CRM EDA", "Parcelas recorrentes por aluno: marcar como paga, vencimentos e número de parcelas."),
  component: Page,
});

function Page() {
  const { data: prof, isPending, user, authLoading } = useProfile();
  const [mes, setMes] = useState(todayISO().slice(0, 7));
  if (authLoading || (user && isPending)) return <Msg>A carregar…</Msg>;
  if (!prof?.isGerencia) return <Msg>Esta página é só para a gerência.</Msg>;
  const p = monthRange(mes);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Parcelas</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--text2)" }}>Vendas recorrentes: uma linha por aluno, uma coluna por parcela.</p>
        </div>
        <label className="text-xs" style={{ color: "var(--text2)" }}>
          Mês
          <input type="month" className="eda-input mt-1 block" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </label>
      </div>
      <Parcelas {...p} />
    </div>
  );
}
