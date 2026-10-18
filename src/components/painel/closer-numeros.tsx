import { CallsHistoryNote } from '@/components/CallsHistoryNote';
import { usePeriod } from "@/lib/period";
import { PeriodFilter } from "@/components/PeriodFilter";
import { useCallsSummary, EMPTY_CALLS, callActivity } from '@/lib/calls-reporting';
import { CallStats } from '@/components/CallsAnalysis';
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { eur } from "@/lib/format";
import { useFinanceMembers, useFinanceSummary, EMPTY_SUMMARY, EMPTY_MEMBER } from "@/lib/finance-reporting";
import { avaliarCloser } from "@/lib/feedback-operacional";
import { FeedbackOperacional, usePrevDaily } from "@/components/painel/FeedbackOperacional";


function localISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
type Period = "week" | "month" | "custom";

function isoToday() { return localISO(new Date()); }
function monthStartISO() {
  const d = new Date();
  return localISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function weekStartISO() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localISO(d);
}

export function MeusNumerosCloser() {
  const { data: profile } = useProfile();
  const role = profile?.role;
  const memberId = profile?.profile?.member_id as string | undefined;
  const isSocio = role === "socio";

  const periodState = usePeriod("mes");
  const { from, to } = periodState;
  const [selectedMember, setSelectedMember] = useState<string | "all">(memberId ?? "all");


  const { data: closerMembers } = useQuery({
    queryKey: ["members-closer"],
    enabled: isSocio,
    queryFn: async () => {
      const { data } = await supabase.from("members").select("id, nome").eq("role", "closer").eq("ativo", true).order("nome");
      return data ?? [];
    },
  });

  const filterMember = isSocio ? selectedMember : memberId;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["closer_daily", "range", filterMember, from, to],
    enabled: !!filterMember,
    queryFn: async () => {
      let q = (supabase as any).from("closer_daily").select("*").gte("data", from).lte("data", to);
      if (filterMember && filterMember !== "all") q = q.eq("member_id", filterMember);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: callResumo = EMPTY_CALLS } = useCallsSummary(from, to, null, filterMember);
  const t = callActivity(callResumo);
  const { data: financeiro } = useFinanceMembers(from, to, "closer");
  const { data: resumo = EMPTY_SUMMARY } = useFinanceSummary(from, to);
  const selectedFinance = filterMember === "all" ? resumo : financeiro?.find(r => r.member_id === filterMember) ?? EMPTY_MEMBER;
  const fat = { bruto: selectedFinance.bruto, liquido: selectedFinance.liquido, nVendas: selectedFinance.vendas,
    nSinais: selectedFinance.sinais, valorSinais: selectedFinance.valor_sinais, ticketMedio: selectedFinance.ticket_medio };

  const vendasN = fat.nVendas;
  const vendasValor = fat.bruto;
  const valorRecebido = fat.liquido;
  const sinaisN = fat.nSinais;
  const sinaisValor = fat.valorSinais;


  const taxaNoShow = pct1(t.calls_noshow, t.calls_realizadas + t.calls_noshow);
  const taxaFecho = pct(vendasN, t.calls_realizadas);
  const ticketMedio = fat.ticketMedio;
  const convSinal = pct(vendasN, sinaisN + vendasN);
  const nDias = diasUteis(from, to);
  const prevRows = usePrevDaily("closer_daily", filterMember, from, to);
  const fb = useMemo(
    () => avaliarCloser({ rows: rows ?? [], prevRows, calls: callResumo, bruto: vendasValor, liquido: valorRecebido, nVendas: vendasN, nSinais: sinaisN }),
    [rows, prevRows, callResumo, vendasValor, valorRecebido, vendasN, sinaisN],
  );
  const mediaDia = nDias ? (t.calls_realizadas / nDias).toFixed(1).replace(".", ",") : "0";


  if (!memberId && !isSocio) {
    return (
      <div className="eda-card">
        <p className="text-sm" style={{ color: "var(--text2)" }}>
          O teu utilizador não está ligado a um membro.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Números Closer</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          Calls validadas no período.
        </p>
      </div>

      <div className="eda-card flex flex-wrap items-end gap-3">
        <PeriodFilter period={periodState} />
        {isSocio && (
          <div>
            <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>Closer</label>
            <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)} className="eda-input">
              <option value="all">Todos (soma)</option>
              {(closerMembers ?? []).map((m: any) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm">A carregar...</div>
      ) : (
        <div className="space-y-6">
          <FeedbackOperacional fb={fb} chave={`${filterMember}|${from}|${to}`} isAll={filterMember === "all"} />
          <Grupo titulo="Calls">
            <Kpi label="Calls recebidas" value={t.calls_recebidas} cor="var(--accent-bright)" />
            <Kpi label="Calls realizadas" value={t.calls_realizadas} />
            <Kpi label="Taxa de No-show" value={`${taxaNoShow}%`} />
            <Kpi label="Média de calls realizadas/dia" value={mediaDia} />
            <Kpi label="Remarcações" value={t.calls_remarcadas} />
            <Kpi label="Por validar" value={callResumo.por_validar} cor={callResumo.atrasadas ? "var(--red)" : undefined} />
            <Kpi label="Não compareceu" value={callResumo.nao_compareceu} />
            <Kpi label="Por validar >24h" value={callResumo.atrasadas} cor={callResumo.atrasadas ? "var(--red)" : undefined} />
          </Grupo>
          <CallsHistoryNote r={callResumo} />
          <Grupo titulo="Vendas">
            <Kpi label="Faturamento Bruto" value={eur(vendasValor)} cor="var(--green)" />
            <Kpi label="Faturamento Líquido / Caixa" value={eur(valorRecebido)} cor="var(--green)" />
            <Kpi label="Taxa de caixa coletado" value={`${pct1(valorRecebido, vendasValor)}%`} />
            <Kpi label="Vendas fechadas" value={vendasN} />
            <Kpi label="Taxa de fecho" value={`${taxaFecho}%`} />
            <Kpi label="Ticket médio" value={eur(ticketMedio)} />
          </Grupo>
          <Grupo titulo="Sinais / Follow">
            <Kpi label="Sinais recebidos" value={sinaisN} cor="var(--gold)" />
            <Kpi label="Valor em sinais" value={eur(sinaisValor)} cor="var(--gold)" />
            <Kpi label="Conversão sinal → venda" value={`${convSinal}%`} />
          </Grupo>
        </div>
      )}
    </div>
  );
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

// Dias de segunda a sábado entre from e min(to, hoje), inclusive.
function diasUteis(from: string, to: string) {
  const hoje = isoToday();
  const fim = to < hoje ? to : hoje;
  if (fim < from) return 0;
  let n = 0;
  const d = new Date(from + "T12:00:00Z");
  const end = new Date(fim + "T12:00:00Z");
  while (d <= end) {
    if (d.getUTCDay() !== 0) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-xs uppercase font-semibold mb-2 tracking-wider" style={{ color: "var(--text2)" }}>{titulo}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">{children}</div>
    </section>
  );
}

function Kpi({ label, value, cor }: { label: string; value: string | number; cor?: string }) {
  return (
    <div className="eda-kpi">
      <div className="text-[11px] uppercase font-semibold" style={{ color: "var(--text3)" }}>{label}</div>
      <div className="text-xl font-bold mt-1" style={cor ? { color: cor } : undefined}>{value}</div>
    </div>
  );
}
