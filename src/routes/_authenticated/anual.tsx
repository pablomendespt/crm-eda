import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { eur } from "@/lib/format";
import { financeRpc, monthLabel, posLabel, MONTH_NAMES, type FinanceMonth, type FinanceRanking } from "@/lib/finance-reporting";
import { pageMeta } from "@/lib/page-meta";
import { Avatar } from "@/components/Avatar";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";

export const Route = createFileRoute("/_authenticated/anual")({
  head: () => pageMeta("Visão Anual — CRM EDA", "Faturamento bruto e líquido mês a mês da Europa Digital Academy, com comparativo por membro."),
  component: Anual,
});

type Annual = { meses: FinanceMonth[]; bruto: number; liquido: number; vendas: number; media: number; melhor: number; melhor_mes: string | null };
type ComparativoData = { meses: FinanceMonth[] | null; closers: FinanceRanking[]; sdrs: FinanceRanking[] };
const CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const GRAD = "linear-gradient(90deg,#2563eb,#38bdf8)";

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="w-full h-2 rounded-full" style={{ background: "var(--surface2)" }}>
      <div className="h-2 rounded-full" style={{ width: `${(value / max) * 100}%`, background: GRAD }} />
    </div>
  );
}

function Ranking({ title, rows, fotos }: { title: string; rows: FinanceRanking[]; fotos: Map<string, { foto_url?: string | null }> }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.bruto)));
  const total = rows.reduce((s, r) => s + Number(r.bruto), 0);
  return (
    <div className="eda-card">
      <div className="flex justify-between items-baseline mb-4 gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs" style={{ color: "var(--text3)" }}>Total {eur(total)}</span>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={`${r.member_id ?? r.nome}`}>
            <div className="flex justify-between text-sm mb-1 gap-3">
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="w-7 text-xs font-bold shrink-0" style={{ color: i < 3 ? "var(--gold)" : "var(--text3)" }}>{posLabel(i)}</span>
                <Avatar nome={r.nome} foto={fotos.get(r.nome)?.foto_url} size={28} />
                <span className="truncate">{r.nome}{r.member_id && !r.ativo ? <span style={{ color: "var(--text3)" }}> (inativo)</span> : null}</span>
              </span>
              <span className="shrink-0 text-right">{eur(Number(r.bruto))}<span className="text-xs" style={{ color: "var(--text3)" }}> · {r.vendas} {r.vendas === 1 ? "venda" : "vendas"}</span></span>
            </div>
            <Bar value={Number(r.bruto)} max={max} />
          </div>
        ))}
        {!rows.length && <div className="text-sm" style={{ color: "var(--text3)" }}>Sem vendas no período.</div>}
      </div>
    </div>
  );
}

function Anual() {
  const { porNome } = useEquipaFotos();
  const atual = new Date().getFullYear();
  const [year, setYear] = useState(atual);
  const [modo, setModo] = useState<"anual" | "mensal">("anual");
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const anos = Array.from({ length: Math.max(1, atual - 2026 + 2) }, (_, i) => 2026 + i).filter((y) => y <= atual + 1);

  const { data } = useQuery({ queryKey: ["finance", "annual", year], queryFn: () => financeRpc<Annual>("fin_anual", { p_ano: year }) });
  const { data: comp } = useQuery({
    queryKey: ["finance", "comparison", year, modo === "mensal" ? mes : null],
    queryFn: () => financeRpc<ComparativoData>("fin_comparativo", { p_ano: year, p_mes: modo === "mensal" ? mes : null }),
  });

  const meses = data?.meses ?? [];
  const max = Math.max(1, data?.melhor ?? 0);
  const temRegisto = meses.some((m) => m.origem === "registo" && (m.bruto ?? 0) > 0);
  const mesesComp = (comp?.meses ?? []).filter((m) => !m.futuro && (m.bruto ?? 0) > 0);
  const maxMonth = Math.max(1, ...mesesComp.map((m) => m.bruto ?? 0));
  const periodo = modo === "anual" ? String(year) : monthLabel(`${year}-${String(mes).padStart(2, "0")}`);

  const kpi = (label: string, value: string, sub?: string, color?: string) => (
    <div className="eda-kpi">
      <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>{label}</div>
      <div className="text-2xl font-bold mt-2" style={{ color: color ?? "var(--text)" }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--text3)" }}>{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Visão Anual {year}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Receita mês a mês. Só EDA, sem vendas canceladas nem sinais.</p>
        </div>
        <label className="text-xs" style={{ color: "var(--text3)" }}>
          Ano{" "}
          <select aria-label="Ano" className="eda-input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {anos.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpi("Bruto anual", eur(data?.bruto ?? 0), undefined, "var(--green)")}
        {kpi("Líquido anual", eur(data?.liquido ?? 0), "Pago das vendas de cada mês", "var(--green)")}
        {kpi("Média mensal (bruto)", eur(data?.media ?? 0), "Só meses com dados")}
        {kpi("Melhor mês (bruto)", eur(data?.melhor ?? 0), data?.melhor_mes ? monthLabel(data.melhor_mes) : undefined, "var(--gold)")}
      </div>

      <div className="eda-card overflow-x-auto">
        <div className="flex items-end gap-2 min-w-[520px]" style={{ height: 260 }}>
          {CURTOS.map((nome, i) => {
            const v = meses[i]?.bruto ?? 0;
            const CHART_H = 210;
            const h = v > 0 ? Math.max(2, (v / max) * CHART_H) : 0;
            return (
              <div key={nome} className="flex-1 flex flex-col items-center justify-end h-full">
                <div className="text-[10px] mb-1 text-center" style={{ color: "var(--text2)" }}>{v > 0 ? Math.round(v).toLocaleString("pt-PT") : ""}</div>
                <div className="w-full flex items-end justify-center" style={{ height: CHART_H }}>
                  {v > 0 && <div className="w-full rounded-t" style={{ height: h, background: "linear-gradient(180deg, var(--accent), rgba(77,136,255,0.35))" }} />}
                </div>
                <div className="text-xs mt-2" style={{ color: "var(--text3)" }}>{nome}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="eda-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
              <th className="py-2">Mês</th><th className="text-right pr-3">Bruto</th><th className="text-right pr-3">Líquido</th><th className="text-right">Vendas</th>
            </tr>
          </thead>
          <tbody>
            {CURTOS.map((nome, i) => {
              const m = meses[i];
              const vazio = !m || m.futuro;
              const val = (n: number | null | undefined) => (vazio || n == null ? "—" : eur(n));
              return (
                <tr key={nome} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-3 whitespace-nowrap">{nome}{m?.origem === "registo" ? <span style={{ color: "var(--text3)" }}>{" *"}</span> : null}</td>
                  <td className="text-right font-semibold pr-3">{val(m?.bruto)}</td>
                  <td className="text-right pr-3">{val(m?.liquido)}</td>
                  <td className="text-right">{vazio ? "—" : m?.vendas ?? 0}</td>
                </tr>
              );
            })}
            <tr className="border-t font-bold" style={{ borderColor: "var(--border)" }}>
              <td className="py-2 pr-3">Total</td>
              <td className="text-right pr-3" style={{ color: "var(--green)" }}>{eur(data?.bruto ?? 0)}</td>
              <td className="text-right pr-3" style={{ color: "var(--green)" }}>{eur(data?.liquido ?? 0)}</td>
              <td className="text-right">{data?.vendas ?? 0}</td>
            </tr>
          </tbody>
        </table>
        {temRegisto && <p className="text-[11px] mt-3" style={{ color: "var(--text3)" }}>* Jan–Jun: dados do registo histórico (pago acumulado).</p>}
      </div>

      <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Comparativo</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>{periodo} · só EDA, sem vendas canceladas nem sinais.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" className="inline-flex rounded-md overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {(["anual", "mensal"] as const).map((m) => (
                <button key={m} role="tab" aria-selected={modo === m} onClick={() => setModo(m)} className="px-4 py-2 text-sm min-h-[40px]"
                  style={{ background: modo === m ? "var(--accent)" : "transparent", color: modo === m ? "#fff" : "var(--text2)" }}>
                  {m === "anual" ? "Anual" : "Mensal"}
                </button>
              ))}
            </div>
            {modo === "mensal" && (
              <select aria-label="Mês" className="eda-input" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="eda-card mt-4">
          <h3 className="font-semibold mb-4">Por mês</h3>
          <div className="space-y-3">
            {mesesComp.map((m) => (
              <div key={m.mes}>
                <div className="flex flex-wrap justify-between text-sm mb-1 gap-x-3">
                  <span>{monthLabel(m.mes)}{m.origem === "registo" ? <span style={{ color: "var(--text3)" }}> *</span> : null}</span>
                  <span style={{ color: "var(--green)" }}>{eur(m.bruto ?? 0)} · líquido {eur(m.liquido ?? 0)}</span>
                </div>
                <Bar value={m.bruto ?? 0} max={maxMonth} />
              </div>
            ))}
            {!mesesComp.length && <div className="text-sm" style={{ color: "var(--text3)" }}>Sem vendas no período.</div>}
          </div>
          {mesesComp.some((m) => m.origem === "registo") && <p className="text-[11px] mt-3" style={{ color: "var(--text3)" }}>* Jan–Jun: dados do registo histórico (pago acumulado).</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Ranking title={`Por closer · ${periodo}`} rows={comp?.closers ?? []} fotos={porNome} />
          <Ranking title={`Por SDR · ${periodo}`} rows={comp?.sdrs ?? []} fotos={porNome} />
        </div>
      </div>
    </div>
  );
}
