import { CallsHistoryNote } from '@/components/CallsHistoryNote';
import { usePeriod } from "@/lib/period";
import { PeriodFilter } from "@/components/PeriodFilter";
import { useCallsSummary, EMPTY_CALLS } from '@/lib/calls-reporting';
import { CallStats, CallsAnalysis } from '@/components/CallsAnalysis';
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { eur } from "@/lib/format";
import { useFinanceMembers, useFinanceSummary, EMPTY_SUMMARY, EMPTY_MEMBER } from "@/lib/finance-reporting";
import { avaliarSdr } from "@/lib/feedback-operacional";
import { FeedbackOperacional, usePrevDaily } from "@/components/painel/FeedbackOperacional";
import { SdrMetasCalls } from "@/components/SdrMetasCalls";


function localISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
type Period = "week" | "month" | "custom";

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISO(d);
}
function monthStartISO() {
  const d = new Date();
  return localISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function weekStartISO() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - day);
  return localISO(d);
}

function Grupo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase font-semibold mb-2" style={{ color: "var(--text2)" }}>{title}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

export function MeusNumeros() {
  const { data: profile } = useProfile();
  const role = profile?.role;
  const memberId = profile?.profile?.member_id as string | undefined;
  const isSocio = role === "socio";

  const periodState = usePeriod("7d");
  const { from, to } = periodState;
  const [selectedMember, setSelectedMember] = useState<string | "all">(memberId ?? "all");


  // Lista de SDRs (só socios podem alternar)
  const { data: sdrMembers } = useQuery({
    queryKey: ["members-sdr"],
    enabled: isSocio,
    queryFn: async () => {
      const { data } = await supabase.from("members").select("id, nome").eq("role", "sdr").eq("ativo", true).order("nome");
      return data ?? [];
    },
  });

  const filterMember = isSocio ? selectedMember : memberId;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["sdr_daily", "range", filterMember, from, to],
    enabled: !!filterMember,
    queryFn: async () => {
      let q = (supabase as any).from("sdr_daily").select("*").gte("data", from).lte("data", to);
      if (filterMember && filterMember !== "all") q = q.eq("member_id", filterMember);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const totals = useMemo(() => {
    const t = {
      conversas_iniciadas: 0, conversas_leandro: 0, conversas_pablo: 0,
      respostas_1a: 0, respostas_leandro: 0, respostas_pablo: 0,
      ligacoes_feitas: 0, ligacoes_atendidas: 0, agendamentos_ligacao: 0,

      leads_qualificados: 0,
      vendas_das_calls: 0, vendas_diretas: 0,

    };
    (rows ?? []).forEach((r: any) => {
      for (const k of Object.keys(t)) (t as any)[k] += Number(r[k] ?? 0);
    });
    return t;
  }, [rows]);

  const { data: callResumo = EMPTY_CALLS } = useCallsSummary(from, to, filterMember);
  const { data: perfilPablo = EMPTY_CALLS } = useCallsSummary(from, to, filterMember, null, 'realizacao', 'Pablo');
  const { data: perfilLeandro = EMPTY_CALLS } = useCallsSummary(from, to, filterMember, null, 'realizacao', 'Leandro');
  const { data: financeiro } = useFinanceMembers(from, to, "sdr");
  const { data: resumo = EMPTY_SUMMARY } = useFinanceSummary(from, to);
  const selectedFinance = filterMember === "all" ? resumo : financeiro?.find(r => r.member_id === filterMember) ?? EMPTY_MEMBER;
  const fat = { bruto: selectedFinance.bruto, liquido: selectedFinance.liquido, nVendas: selectedFinance.vendas,
    nSinais: selectedFinance.sinais, valorSinais: selectedFinance.valor_sinais, ticketMedio: selectedFinance.ticket_medio };

  const prevRows = usePrevDaily("sdr_daily", filterMember, from, to);
  const fb = useMemo(
    () => avaliarSdr({ rows: rows ?? [], prevRows, calls: callResumo, bruto: fat.bruto, liquido: fat.liquido }),
    [rows, prevRows, callResumo, fat.bruto, fat.liquido],
  );

  const taxa1a = pct(totals.respostas_1a, totals.conversas_iniciadas);
  const pctCallMarcada = pct(callResumo.marcadas, totals.respostas_1a);
  const convCallMarcada = pct(totals.vendas_das_calls, callResumo.marcadas);
  const convDireta = pct(totals.vendas_diretas, totals.respostas_1a);
  const pctAtendidas = pct(totals.ligacoes_atendidas, totals.ligacoes_feitas);
  // Soma primeiro (já feita em totals), depois divide — nunca média de percentagens.
  const convLigacao = pct(totals.agendamentos_ligacao, totals.ligacoes_atendidas);
  const taxaLeandro = pct(totals.respostas_leandro, totals.conversas_leandro);
  const taxaPablo = pct(totals.respostas_pablo, totals.conversas_pablo);

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
        <h1 className="text-2xl font-bold">Números SDR</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          Calls validadas e atividade no período.
        </p>
      </div>

      <div className="eda-card flex flex-wrap items-end gap-3">
        <PeriodFilter period={periodState} />
        {isSocio && (
          <div>
            <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>SDR</label>
            <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)} className="eda-input">
              <option value="all">Todos (soma)</option>
              {(sdrMembers ?? []).map((m: any) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm">A carregar...</div>
      ) : (
        <>
          <FeedbackOperacional fb={fb} chave={`${filterMember}|${from}|${to}`} isAll={filterMember === "all"} />
          <CallStats r={callResumo} />
          <CallsHistoryNote r={callResumo} />
          <Grupo title="Aquisição / Conversas">
            <Kpi label="Conversas iniciadas" value={totals.conversas_iniciadas} />
            <Kpi label="Respostas 1ª msg" value={totals.respostas_1a} />
            <Kpi label="Taxa 1ª mensagem" value={`${taxa1a}%`} />
            <Kpi label="Calls marcadas" value={callResumo.marcadas} />
            <Kpi label="% call marcada" value={`${pctCallMarcada}%`} />
          </Grupo>

          <Grupo title="Ligações">
            <Kpi label="Ligações feitas" value={totals.ligacoes_feitas} />
            <Kpi label="Ligações atendidas" value={totals.ligacoes_atendidas} />
            <Kpi label="% atendidas" value={`${pctAtendidas}%`} />
            <Kpi label="Conversão ligação → call marcada" value={`${convLigacao}%`} />
          </Grupo>

          <Grupo title="Vendas">
            <Kpi label="Vendas de call marcada" value={totals.vendas_das_calls} />
            <Kpi label="Conversão call marcada" value={`${convCallMarcada}%`} />
            <Kpi label="Vendas diretas" value={totals.vendas_diretas} />
            <Kpi label="Conversão venda direta" value={`${convDireta}%`} />
            <Kpi label="Faturamento Bruto" value={eur(fat.bruto)} />
            <Kpi label="Faturamento Líquido" value={eur(fat.liquido)} />
          </Grupo>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="eda-card">
              <div className="text-xs uppercase font-semibold mb-3" style={{ color: "var(--text2)" }}>
                Origem: @leandrosantanapt
              </div>
              <div className="grid grid-cols-4 gap-3">
                <MiniKpi label="Conversas" value={totals.conversas_leandro} />
                <MiniKpi label="Respostas" value={totals.respostas_leandro} />
                <MiniKpi label="Taxa" value={`${taxaLeandro}%`} />
                <MiniKpi label="Agendamentos" value={perfilLeandro.marcadas} />
              </div>
            </div>
            <div className="eda-card">
              <div className="text-xs uppercase font-semibold mb-3" style={{ color: "var(--text2)" }}>
                Origem: @pablomendespt
              </div>
              <div className="grid grid-cols-4 gap-3">
                <MiniKpi label="Conversas" value={totals.conversas_pablo} />
                <MiniKpi label="Respostas" value={totals.respostas_pablo} />
                <MiniKpi label="Taxa" value={`${taxaPablo}%`} />
                <MiniKpi label="Agendamentos" value={perfilPablo.marcadas} />
              </div>
            </div>
          </div>

          <CallsAnalysis from={from} to={to} sdr={filterMember}/>
          <SdrMetasCalls
            filterMember={filterMember}
            isSocio={isSocio}
            sdrMembers={(sdrMembers ?? []) as { id: string; nome: string }[]}
          />
        </>
      )}
    </div>
  );
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="eda-kpi">
      <div className="text-[11px] uppercase font-semibold" style={{ color: "var(--text3)" }}>{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase" style={{ color: "var(--text3)" }}>{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
