import { CallsHistoryNote } from '@/components/CallsHistoryNote';
import { usePeriod } from "@/lib/period";
import { PeriodFilter } from "@/components/PeriodFilter";
import { useCallsAnalysis, useCallsSummary, EMPTY_CALLS, EMPTY_ANALYSIS, callActivity } from '@/lib/calls-reporting';
import { pageMeta } from "@/lib/page-meta";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { useRealtimeSync } from "@/hooks/useRealtime";
import { eur, localISO } from "@/lib/format";
import { EMPTY_SUMMARY, useFinanceSummary, useFinanceMembers, reportingShape } from "@/lib/finance-reporting";


export const Route = createFileRoute("/_authenticated/visao-geral")({
  head: () => pageMeta("Visão Geral, Fundador — CRM EDA", "Visão geral dos resultados comerciais da equipa para os sócios da EDA."),
  component: VisaoGeral,
});

type Period = "week" | "month" | "custom";

function weekStartISO() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localISO(d);
}

function VisaoGeral() {
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const role = profile?.role;
  useRealtimeSync();

  useEffect(() => {
    const ch = supabase
      .channel("visao-geral-rollup")
      .on("postgres_changes", { event: "*", schema: "public", table: "sdr_daily" }, () => {
        qc.invalidateQueries({ queryKey: ["sdr_daily-range-all"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "closer_daily" }, () => {
        qc.invalidateQueries({ queryKey: ["closer_daily-range-all"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);


  const periodState = usePeriod("mes");
  const { from, to } = periodState;


  const { data: members } = useQuery({
    queryKey: ["members-all"],
    queryFn: async () => {
      const { data } = await supabase.from("members").select("id, nome, role").eq("ativo", true).order("nome");
      // "TESTE" é registo de desenvolvimento — nunca aparece em vistas de produção.
      return (data ?? []).filter((m: any) => String(m.nome ?? "").trim().toUpperCase() !== "TESTE");
    },
  });

  const realIds = useMemo(() => new Set((members ?? []).map((m: any) => m.id)), [members]);

  const { data: sdrRows } = useQuery({
    queryKey: ["sdr_daily-range-all", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sdr_daily").select("*").gte("data", from).lte("data", to);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: closerRows } = useQuery({
    queryKey: ["closer_daily-range-all", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("closer_daily").select("*").gte("data", from).lte("data", to);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: resumo = EMPTY_SUMMARY } = useFinanceSummary(from, to);
  const { data: finClosers } = useFinanceMembers(from, to);
  const { data: finSdrs } = useFinanceMembers(from, to, "sdr");
  const fat = reportingShape(resumo, finClosers, finSdrs);
  const nSinais = fat.nSinais;
  const valorSinais = fat.valorSinais;
  const cash = { total: fat.liquido, porCloser: fat.liquidoPorCloser, porSdr: fat.liquidoPorSdr };

  const vendasPorCloser = useMemo(() => {
    const out: Record<string, { n: number; valor: number }> = {};
    Object.keys(fat.brutoPorCloser).forEach((id) => {
      out[id] = { n: fat.vendasPorCloser[id] ?? 0, valor: fat.brutoPorCloser[id] ?? 0 };
    });
    return out;
  }, [fat]);

  const vendasPorSdr = useMemo(() => {
    const out: Record<string, { n: number; valor: number }> = {};
    Object.keys(fat.brutoPorSdr).forEach((id) => {
      out[id] = { n: fat.vendasPorSdr[id] ?? 0, valor: fat.brutoPorSdr[id] ?? 0 };
    });
    return out;
  }, [fat]);

  const totalVendasN = fat.nVendas;
  const totalVendasValor = fat.bruto;



  const memberById = useMemo(() => {

    const m: Record<string, { nome: string; role: string }> = {};
    // Membros inativos com vendas no período continuam a aparecer (nome vindo do servidor).
    [...(finClosers ?? []), ...(finSdrs ?? [])].forEach((x) => { m[x.member_id] = { nome: x.nome, role: "" }; });
    (members ?? []).forEach((x: any) => { m[x.id] = { nome: x.nome, role: x.role }; });
    return m;
  }, [members, finClosers, finSdrs]);

  // Só membros reais da equipa (exclui registos de teste).
  const sdrReal = useMemo(
    () => (sdrRows ?? []).filter((r: any) => realIds.size === 0 || realIds.has(r.member_id)),
    [sdrRows, realIds],
  );
  const closerReal = useMemo(
    () => (closerRows ?? []).filter((r: any) => realIds.size === 0 || realIds.has(r.member_id)),
    [closerRows, realIds],
  );

  const dailySdrTotals = useMemo(() => sum(sdrReal, [
    "conversas_iniciadas","conversas_leandro","conversas_pablo",
    "respostas_1a","respostas_leandro","respostas_pablo",
    "ligacoes_feitas","ligacoes_atendidas",
    "leads_qualificados","vendas_das_calls","vendas_diretas",

  ]), [sdrReal]);

  const dailyCloserTotals = useMemo(() => sum(closerReal, [


    "sinais_recebidos",
  ]), [closerReal]);

  const dailyPerSdr = useMemo(() => groupBy(sdrReal, "member_id", [
    "conversas_iniciadas","respostas_1a","leads_qualificados",
    "vendas_das_calls","vendas_diretas",
  ]), [sdrReal]);

  const dailyPerCloser = useMemo(() => groupBy(closerReal, "member_id", [

    "sinais_recebidos",
  ]), [closerReal]);

  const { data: callTotal = EMPTY_CALLS } = useCallsSummary(from,to);
  const { data: callMembers = EMPTY_ANALYSIS } = useCallsAnalysis(from,to);
  const sdrTotals = { ...dailySdrTotals, ...callActivity(callTotal) };
  const closerTotals = { ...dailyCloserTotals, ...callActivity(callTotal) };
  const perSdr = { ...dailyPerSdr };
  const perCloser = { ...dailyPerCloser };
  callMembers.membros.forEach(m=>{const dict=m.papel==='sdr'?perSdr:perCloser;dict[m.member_id]={...dict[m.member_id],...callActivity(m.resumo)};});
  // ---- REGRA FIXA DA TABELA "POR SDR" ----------------------------------
  // SDRs fixos da operação = membros cujo papel na tabela `members` é 'sdr'
  // (hoje Davi e Isaac). Aparecem SEMPRE, mesmo com 0 vendas no período.
  // Qualquer outra pessoa (closer/fundador) só entra se estiver marcada como
  // SDR de pelo menos uma venda fechada do período (lead autogerado).
  const linhasSdr = useMemo(() => {
    const fixos = (members ?? []).filter((m: any) => m.role === "sdr").map((m: any) => m.id as string);
    const autogerados = Object.keys(vendasPorSdr).filter((id) => !fixos.includes(id));
    return [...fixos, ...autogerados].filter((id) => realIds.size === 0 || realIds.has(id) || (vendasPorSdr[id]?.n ?? 0) > 0);
  }, [members, vendasPorSdr, realIds]);


  if (role && role !== "socio") {
    return <Navigate to="/funil" />;
  }

  const taxaNaoCompareceu = pct1(closerTotals.calls_noshow, closerTotals.calls_realizadas + closerTotals.calls_noshow);
  const taxaFecho = pct(totalVendasN, closerTotals.calls_realizadas);
  const ticketMedio = resumo.ticket_medio;

  const taxaCallMarcada = pct(sdrTotals.calls_marcadas, sdrTotals.respostas_1a);
  const taxaResposta = pct(sdrTotals.respostas_1a, sdrTotals.conversas_iniciadas);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Visão Geral</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          Rollup diário da equipa. SDR e closer no mesmo painel.
        </p>
      </div>

      <div className="eda-card flex flex-wrap items-end gap-3">
        <PeriodFilter period={periodState} />
      </div>

      <section>
        <div className="text-xs uppercase font-semibold mb-3" style={{ color: "var(--text2)" }}>Fecho (Closers)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Faturamento Bruto" value={eur(totalVendasValor)} />
          <Kpi label="Faturamento Líquido" value={eur(cash.total)} />
          <Kpi label="Vendas fechadas" value={totalVendasN} />
          <Kpi label="Ticket médio" value={eur(ticketMedio)} />

          <Kpi label="Calls recebidas" value={closerTotals.calls_recebidas} />
          <Kpi label="Calls realizadas" value={closerTotals.calls_realizadas} />
          <Kpi label="Taxa de No-show" value={`${taxaNaoCompareceu}%`} />
          <Kpi label="Taxa de fecho" value={`${taxaFecho}%`} />
          <Kpi label="Sinais recebidos" value={nSinais} />
          <Kpi label="Valor em sinais" value={eur(valorSinais)} />

          <Kpi label="Não Compareceu" value={closerTotals.calls_noshow} />
          <Kpi label="Remarcadas" value={closerTotals.calls_remarcadas} />
        </div>
        <div className="mt-2"><CallsHistoryNote r={callTotal} /></div>
      </section>

      <section>
        <div className="text-xs uppercase font-semibold mb-3" style={{ color: "var(--text2)" }}>Pré-venda (SDRs)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Conversas iniciadas" value={sdrTotals.conversas_iniciadas} />
          <Kpi label="Leandro" value={sdrTotals.conversas_leandro} />
          <Kpi label="Pablo" value={sdrTotals.conversas_pablo} />
          <Kpi label="Respostas 1as" value={sdrTotals.respostas_1a} />
          <Kpi label="Taxa de resposta" value={`${taxaResposta}%`} />
          <Kpi label="Ligações feitas" value={sdrTotals.ligacoes_feitas} />
          <Kpi label="Ligações atendidas" value={sdrTotals.ligacoes_atendidas} />
          <Kpi label="Calls marcadas" value={sdrTotals.calls_marcadas} />
          <Kpi label="Taxa call marcada" value={`${taxaCallMarcada}%`} />
          <Kpi label="Leads qualificados" value={sdrTotals.leads_qualificados} />
        </div>
      </section>

      <section className="eda-card">
        <div className="text-xs uppercase font-semibold mb-3" style={{ color: "var(--text2)" }}>Por closer</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--text3)" }} className="text-[11px] uppercase">
                <th className="text-left py-2">Closer</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Realizadas</th>
                <th className="text-right">Vendas</th>
                <th className="text-right">Bruto</th>
                <th className="text-right">Líquido</th>
                <th className="text-right">Ticket médio</th>
                <th className="text-right">Sinais</th>
                <th className="text-right">Valor sinais</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set([...Object.keys(perCloser), ...Object.keys(vendasPorCloser), ...Object.keys(cash.porCloser), ...Object.keys(fat.sinaisPorCloser)]))
                .filter((id) => realIds.size === 0 || realIds.has(id) || (vendasPorCloser[id]?.n ?? 0) > 0)
                .map((id) => {
                const t: any = perCloser[id] ?? {};
                const v = vendasPorCloser[id] ?? { n: 0, valor: 0 };
                return (
                  <tr key={id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-2">{memberById[id]?.nome ?? "—"}</td>
                    <td className="text-right">{t.calls_recebidas ?? 0}</td>
                    <td className="text-right">{t.calls_realizadas ?? 0}</td>
                    <td className="text-right">{v.n}</td>
                    <td className="text-right">{eur(v.valor)}</td>
                    <td className="text-right">{eur(cash.porCloser[id] ?? 0)}</td>
                    <td className="text-right">{eur(finClosers?.find(r => r.member_id === id)?.ticket_medio ?? 0)}</td>
                    <td className="text-right">{fat.sinaisPorCloser[id] ?? 0}</td>
                    <td className="text-right">{eur(fat.valorSinaisPorCloser[id] ?? 0)}</td>
                  </tr>
                );
              })}
              {Object.keys(perCloser).length === 0 && Object.keys(vendasPorCloser).length === 0 && (
                <tr><td colSpan={10} className="py-4 text-center" style={{ color: "var(--text3)" }}>Sem registos no período</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)" }} className="font-semibold">
                <td className="py-2">Total</td>
                <td className="text-right">{closerTotals.calls_recebidas}</td>
                <td className="text-right">{closerTotals.calls_realizadas}</td>
                <td className="text-right">{totalVendasN}</td>
                <td className="text-right">{eur(totalVendasValor)}</td>
                <td className="text-right">{eur(cash.total)}</td>
                <td className="text-right">{eur(ticketMedio)}</td>
                <td className="text-right">{nSinais}</td>
                <td className="text-right">{eur(valorSinais)}</td>
              </tr>
            </tfoot>

          </table>
        </div>
      </section>

      <section className="eda-card">
        <div className="text-xs uppercase font-semibold mb-3" style={{ color: "var(--text2)" }}>Por SDR</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--text3)" }} className="text-[11px] uppercase">
                <th className="text-left py-2">SDR</th>
                <th className="text-right">Conversas</th>
                <th className="text-right">Respostas</th>
                <th className="text-right">Calls marcadas</th>
                <th className="text-right">Leads qual.</th>
                <th className="text-right">Vendas</th>
                <th className="text-right">Vendas call</th>
                <th className="text-right">Vendas diretas</th>
                <th className="text-right">Bruto</th>
                <th className="text-right">Líquido</th>
                <th className="text-right">Ticket médio</th>
              </tr>
            </thead>
            <tbody>
              {/* REGRA FIXA (ver `linhasSdr`): SDRs fixos (members.role = 'sdr')
                  aparecem sempre; outros só se forem SDR de uma venda fechada. */}
              {linhasSdr
                .map((id) => {
                  const t: any = perSdr[id] ?? {};
                  return (
                    <tr key={id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="py-2">{memberById[id]?.nome ?? "—"}</td>
                      <td className="text-right">{t.conversas_iniciadas ?? 0}</td>
                      <td className="text-right">{t.respostas_1a ?? 0}</td>
                      <td className="text-right">{t.calls_marcadas ?? 0}</td>
                      <td className="text-right">{t.leads_qualificados ?? 0}</td>
                      <td className="text-right">{vendasPorSdr[id]?.n ?? 0}</td>
                      <td className="text-right">{t.vendas_das_calls ?? 0}</td>
                      <td className="text-right">{t.vendas_diretas ?? 0}</td>
                      <td className="text-right">{eur(vendasPorSdr[id]?.valor ?? 0)}</td>
                      <td className="text-right">{eur(cash.porSdr[id] ?? 0)}</td>
                      <td className="text-right">{eur(finSdrs?.find(r => r.member_id === id)?.ticket_medio ?? 0)}</td>
                    </tr>
                  );
                })}
              {Object.keys(perSdr).length === 0 && Object.keys(vendasPorSdr).length === 0 && (
                <tr><td colSpan={10} className="py-4 text-center" style={{ color: "var(--text3)" }}>Sem registos no período</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)" }} className="font-semibold">
                <td className="py-2">Total</td>
                <td className="text-right">{sdrTotals.conversas_iniciadas}</td>
                <td className="text-right">{sdrTotals.respostas_1a}</td>
                <td className="text-right">{sdrTotals.calls_marcadas}</td>
                <td className="text-right">{sdrTotals.leads_qualificados}</td>
                <td className="text-right">{totalVendasN}</td>
                <td className="text-right">{sdrTotals.vendas_das_calls}</td>
                <td className="text-right">{sdrTotals.vendas_diretas}</td>
                <td className="text-right">{eur(totalVendasValor)}</td>
                <td className="text-right">{eur(cash.total)}</td>
                <td className="text-right">{eur(ticketMedio)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

    </div>
  );
}


function sum(rows: any[], keys: string[]) {
  const acc: Record<string, number> = {};
  keys.forEach((k) => (acc[k] = 0));
  rows.forEach((r) => keys.forEach((k) => (acc[k] += Number(r[k] ?? 0))));
  return acc as any;
}

function groupBy(rows: any[], groupKey: string, keys: string[]) {
  const out: Record<string, Record<string, number>> = {};
  rows.forEach((r) => {
    const id = r[groupKey];
    if (!out[id]) { out[id] = {}; keys.forEach((k) => (out[id][k] = 0)); }
    keys.forEach((k) => (out[id][k] += Number(r[k] ?? 0)));
  });
  return out;
}


function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// Percentagem com uma casa decimal, formato pt-PT (ex.: 24,3)
function pct1(n: number, total: number) {
  if (!total) return "0,0";
  return ((n / total) * 100).toFixed(1).replace(".", ",");
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="eda-kpi">
      <div className="text-[11px] uppercase font-semibold" style={{ color: "var(--text3)" }}>{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
