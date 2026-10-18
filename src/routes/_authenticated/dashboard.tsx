import { useCallsSummary, EMPTY_CALLS } from '@/lib/calls-reporting';
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { eur, eurShort, fmtDate } from "@/lib/format";
import { useProfile } from "@/hooks/useAuth";
import { useRealtimeSync } from "@/hooks/useRealtime";
import { EMPTY_SUMMARY, financeRpc, useFinanceSummary, useFinanceSeries } from "@/lib/finance-reporting";

import { TrendingUp, Users, Target, AlertCircle, Percent, Coins, Handshake, Info } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Avatar } from "@/components/Avatar";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { BlocoMetasEquipa } from "@/components/MetasMensaisEquipa";
import { usePeriod, isoLocal } from "@/lib/period";
import { PeriodFilter } from "@/components/PeriodFilter";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function iso(d: Date) { return isoLocal(d); }

function Kpi({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: typeof Users; accent?: string }) {
  return (
    <div className="eda-kpi">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--text2)" }}>{label}</div>
        <Icon size={16} style={{ color: accent ?? "var(--accent)" }} />
      </div>
      <div className="mt-3 text-2xl font-bold" style={{ color: accent ?? "var(--text)" }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--text3)" }}>{sub}</div>}
    </div>
  );
}

function Dashboard() {
  const { data: profile } = useProfile();
  const canViewAll = profile?.canViewAll === true;
  const myMemberId = (profile?.profile as any)?.member_id as string | undefined;
  const { mapa: equipaFotos } = useEquipaFotos();
  useRealtimeSync();

  const period = usePeriod("mes");
  const { preset, from, to } = period;
  const [produto, setProduto] = useState<string>("");
  const [closerId, setCloserId] = useState<string>("");
  const [verTodas, setVerTodas] = useState(false);
  const [infoOport, setInfoOport] = useState(false);


  const { data: members } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return ((data ?? []) as { id: string; nome: string; role: string; ativo: boolean }[]).filter((m) => m.ativo);
    },
  });
  const closers = useMemo(() => (members ?? []).filter((m) => m.role === "closer"), [members]);
  const memberNames = useMemo(() => Object.fromEntries((members ?? []).map((m) => [m.id, m.nome])), [members]);

  const { data: vendasRaw } = useQuery({
    queryKey: ["dashboard-vendas", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendas")
        .select("*")
        .gte("data", from)
        .lte("data", to)
        .order("data", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: resumo = EMPTY_SUMMARY } = useFinanceSummary(from, to, produto, closerId);
  const { data: pendente } = useQuery({ queryKey: ["finance", "pending", from, to, produto, closerId],
    queryFn: async () => (await financeRpc<{ atraso: number; a_receber: number }[]>("fin_resumo_pendente", { p_hoje: iso(new Date()), p_from: from, p_to: to, p_produto: produto || null, p_closer: closerId || null }))[0] });
  const { data: serie } = useFinanceSeries(from, to, "day", produto, closerId);

  const { data: callResumo = EMPTY_CALLS } = useCallsSummary(from,to,null,closerId);
  const { data: oportunidade = { valor: 0, n: 0 } } = useQuery({
    queryKey: ["finance", "opportunities", from, to, produto, closerId],
    queryFn: async () => (await financeRpc<{ valor: number; n: number }[]>("fin_oportunidades", { p_from: from, p_to: to, p_produto: produto || null, p_closer: closerId || null }))[0] ?? { valor: 0, n: 0 },
  });

  const produtos = useMemo(() => {

    const s = new Set<string>();
    (vendasRaw ?? []).forEach((v) => { if (v.produto) s.add(v.produto); });
    return Array.from(s).sort();
  }, [vendasRaw]);

  const filtered = useMemo(() => (vendasRaw ?? []).filter((v) => {
    if (produto && v.produto !== produto) return false;
    if (closerId && v.closer_id !== closerId) return false;
    // Quem não é Pablo/Leandro só vê as próprias vendas (como closer ou SDR).
    if (!canViewAll) {
      if (!myMemberId) return false;
      if (v.closer_id !== myMemberId && v.sdr_id !== myMemberId) return false;
    }
    return true;
  }), [vendasRaw, produto, closerId, canViewAll, myMemberId]);

  const fechadas = useMemo(() => filtered.filter((v) => !v.is_sinal && ["ativo", "quitada"].includes(v.status) && (produto || (v.produto ?? "").trim().toLowerCase() !== "pve")), [filtered, produto]);
  const sinais = useMemo(() => filtered.filter((v) => v.is_sinal && v.status === "sinal_pago"), [filtered]);

  const totalFat = resumo.bruto;
  const nVendas = resumo.vendas;
  const ticketMedio = resumo.ticket_medio;
  const faturamentoLiquido = resumo.liquido;

  const callsRealizadas = callResumo.realizadas;
  const taxaConversaoCall = callsRealizadas ? (nVendas / callsRealizadas) * 100 : 0;


  const chartData = (serie ?? []).filter(r => r.inicio <= iso(new Date())).map(r => ({ data: r.inicio, valor: r.bruto }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">Olá, {(myMemberId && memberNames[myMemberId]) || profile?.profile?.nome}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Painel de vendas · {fmtDate(from)} → {fmtDate(to)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="eda-card flex flex-wrap gap-3 items-end">
        <PeriodFilter period={period} />
        <div>
          <div className="text-[10px] uppercase font-semibold mb-1" style={{ color: "var(--text3)" }}>Produto</div>
          <select className="eda-input" value={produto} onChange={(e) => setProduto(e.target.value)}>
            <option value="">Todos os produtos</option>
            {produtos.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {canViewAll && (
          <div>
            <div className="text-[10px] uppercase font-semibold mb-1" style={{ color: "var(--text3)" }}>Closer</div>
            <select className="eda-input" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
              <option value="">Todos os closers</option>
              {closers.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        )}
      </div>

      <BlocoMetasEquipa refDate={to} isSocio={profile?.role === "socio"} />

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label="Faturamento Bruto" value={eurShort(totalFat)} sub={`${nVendas} vendas fechadas`} icon={TrendingUp} accent="var(--green)" />
        <Kpi label="Líquido (caixa)" value={eur(faturamentoLiquido)} sub="Valor efectivamente recebido no período" icon={Coins} accent="var(--green)" />
        <Kpi label="Vendas fechadas" value={String(nVendas)} icon={Target} />
        <Kpi label="Ticket médio" value={eur(ticketMedio)} icon={Users} />
        <div className="eda-kpi">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--text2)" }}>
              Valor em oportunidade
              <button
                type="button"
                aria-label="O que é o valor em oportunidade"
                title="Valor restante das oportunidades em fechamento ativo. São considerados leads com sinal pago ou data de fechamento definida."
                onClick={() => setInfoOport((s) => !s)}
                className="inline-flex"
                style={{ color: "var(--text3)" }}
              >
                <Info size={13} />
              </button>
            </div>
            <Handshake size={16} style={{ color: "var(--gold)" }} />
          </div>
          {infoOport && (
            <div className="text-[11px] mt-2 p-2 rounded" style={{ background: "var(--surface2)", color: "var(--text2)" }}>
              Valor restante das oportunidades em fechamento ativo. São considerados leads com sinal pago ou data de fechamento definida.
            </div>
          )}
          <div className="mt-3 text-2xl font-bold" style={{ color: "var(--gold)" }}>{eur(oportunidade.valor)}</div>
          <div className="text-xs mt-1" style={{ color: "var(--text3)" }}>
            {oportunidade.n} {oportunidade.n === 1 ? "lead em fechamento" : "leads em fechamento"}
          </div>
        </div>
        <Kpi label="Taxa de conversão de call" value={`${taxaConversaoCall.toFixed(0)}%`} sub={`${nVendas} vendas de ${callsRealizadas} calls realizadas${callResumo.hist_realizadas ? ` (inclui ${callResumo.hist_realizadas} do histórico — registos diários antigos)` : ""}`} icon={Percent} />
        <Kpi label="A receber" value={eur(pendente?.a_receber ?? 0)} icon={Coins} />
        <Kpi label="Em atraso" value={eur(pendente?.atraso ?? 0)} icon={AlertCircle} accent="var(--red)" />
        {profile?.roles.includes("socio") && <Kpi label="Caixa de recorrência" value={eur(resumo.recorrencia ?? 0)} icon={Coins} />}
      </div>

      {/* Chart */}
      <div className="eda-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Evolução do faturamento</h3>
          <span className="text-xs" style={{ color: "var(--gold)" }}>{fmtDate(from)} — {fmtDate(to)}</span>
        </div>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                   <stop offset="0%" stopColor="#2563eb" stopOpacity={0.62} />
                   <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="data" tick={{ fill: "var(--text3)", fontSize: 11 }} tickFormatter={(v) => fmtDate(v).slice(0, 5)} />
              <YAxis tick={{ fill: "var(--text3)", fontSize: 11 }} tickFormatter={(v) => eurShort(Number(v))} />
              <Tooltip
                contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8 }}
                formatter={(v: any) => [eur(Number(v)), "Faturamento"]}
                labelFormatter={(l) => fmtDate(String(l))}
              />
               <Area type="monotone" dataKey="valor" stroke="#38bdf8" strokeWidth={2} fill="url(#fatGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="eda-card">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="font-semibold">{preset === "mes" ? "Vendas fechadas este mês" : "Vendas fechadas no período"}</h3>
            <span className="text-xs" style={{ color: "var(--text3)" }}>{fechadas.length} vendas</span>
          </div>
          <div className="space-y-2">
            {[...fechadas].reverse().slice(0, verTodas ? undefined : 6).map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-3" style={{ borderColor: "var(--border)" }}>
                 <div className="flex min-w-0 items-center gap-3">
                   <Avatar nome={v.closer_id ? memberNames[v.closer_id] ?? "Closer" : "Equipa EDA"} foto={v.closer_id ? equipaFotos.get(v.closer_id)?.foto_url : null} size={34} />
                   <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{v.nome_cliente}</div>
                  <div className="text-xs" style={{ color: "var(--text3)" }}>
                    {fmtDate(v.data)}{v.closer_id ? ` · ${memberNames[v.closer_id] ?? ""}` : ""}{v.produto ? ` · ${v.produto}` : ""}
                   </div>
                 </div>
                </div>
                <div className="text-sm font-semibold shrink-0" style={{ color: "var(--green)" }}>{eur(Number(v.ticket))}</div>
              </div>
            ))}
            {!fechadas.length && <div className="text-sm py-4" style={{ color: "var(--text3)" }}>Sem vendas no período.</div>}
          </div>
          {fechadas.length > 6 && (
            <button
              type="button"
              onClick={() => setVerTodas((s) => !s)}
              className="mt-3 w-full text-xs py-2 rounded"
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)" }}
            >
              {verTodas ? "Ver menos" : `Ver mais (${fechadas.length - 6})`}
            </button>
          )}
        </div>

        <div className="eda-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Sinais pendentes</h3>
            <AlertCircle size={14} style={{ color: "var(--gold)" }} />
          </div>
          <div className="space-y-2">
            {sinais.slice(0, 8).map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-3" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{v.nome_cliente}</div>
                  <div className="text-xs" style={{ color: "var(--text3)" }}>
                    {fmtDate(v.data)}{v.produto ? ` · ${v.produto}` : ""}{v.closer_id ? ` · ${memberNames[v.closer_id] ?? ""}` : ""}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: v.data_prevista_fecho ? "var(--gold)" : "var(--text3)" }}>
                    {v.data_prevista_fecho ? `Fecho previsto: ${fmtDate(v.data_prevista_fecho)}` : "Sem data prevista de fecho"}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold" style={{ color: "var(--gold)" }}>{eur(Number(v.ticket))}</div>
                  <div className="text-[10px]" style={{ color: "var(--text3)" }}>de {eur(Number(v.valor_total_previsto ?? 0))}</div>
                </div>
              </div>
            ))}
            {!sinais.length && <div className="text-sm py-4" style={{ color: "var(--text3)" }}>Nenhum sinal no período.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
