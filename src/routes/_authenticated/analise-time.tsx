import { usePeriod } from "@/lib/period";
import { PeriodFilter } from "@/components/PeriodFilter";
import { CallsAnalysis } from '@/components/CallsAnalysis';
import { useCallsAnalysis, EMPTY_ANALYSIS, EMPTY_CALLS } from '@/lib/calls-reporting';
import { Button } from '@/components/ui/button';
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { eur } from "@/lib/format";
import { useFinanceMembers, EMPTY_MEMBER } from "@/lib/finance-reporting";
import { ResumoIA } from "@/components/ResumoIA";
import { MensagemDia } from "@/components/MensagemDia";
import { Avatar } from "@/components/Avatar";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";

export const Route = createFileRoute("/_authenticated/analise-time")({
  component: Page,
});

const iso = (d: Date) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex"];

type Periodo = "hoje" | "ontem" | "semana" | "mes";
const PERIODOS: { k: Periodo; label: string }[] = [
  { k: "hoje", label: "Hoje" },
  { k: "ontem", label: "Ontem" },
  { k: "semana", label: "Esta semana" },
  { k: "mes", label: "Este mês" },
];

function Page() {
  const { data: profile } = useProfile();
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [customFrom,setCustomFrom]=useState('');
  const [customTo,setCustomTo]=useState('');
  const [base, setBase] = useState('realizacao');
  const periodState = usePeriod("hoje");
  const { mapa: equipaFotos } = useEquipaFotos();

  const hoje = new Date();
  const hojeISO = iso(hoje);
  const ontemISO = iso(addDays(hoje, -1));
  const seg = addDays(hoje, -((hoje.getDay() + 6) % 7) + semanaOffset * 7);
  const semana = DIAS.map((_, i) => iso(addDays(seg, i)));

  const segAtual = iso(addDays(hoje, -((hoje.getDay() + 6) % 7)));
  const mesIni = hojeISO.slice(0, 8) + "01";
  const { from: pIni, to: pFim } = periodState;

  const { data: members } = useQuery({
    queryKey: ["members", "analise"],
    queryFn: async () => {
      const { data, error } = await supabase.from("members").select("id, nome, role, ativo").eq("ativo", true).order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: callAnalysis = EMPTY_ANALYSIS } = useCallsAnalysis(pIni, pFim, base);
  const { data: financeiro } = useFinanceMembers(pIni, pFim);
  const { data: financeiroSdr } = useFinanceMembers(pIni, pFim, "sdr");

  if (profile && profile.role !== "socio") return <Navigate to="/dashboard" replace />;

  const sdrs = (members ?? []).filter((m) => m.role === "sdr");
  const closers = (members ?? []).filter((m) => m.role === "closer");
  const f = new Map((financeiro ?? []).map(r => [r.member_id, r]));
  const linhasCloser = closers.map((c) => {
    const r = callAnalysis.membros.find(m=>m.member_id===c.id)?.resumo ?? EMPTY_CALLS;
    const realizadas = r.realizadas;
    const noshow = r.nao_compareceu;
    const fin = f.get(c.id) ?? EMPTY_MEMBER;
    const nV = fin.vendas;
    return {
      ...c, realizadas, noshow, vendas: nV,
      caixa: fin.liquido, ticket: fin.ticket_medio,
      bruto: fin.bruto,
      conv: realizadas ? Math.round((nV / realizadas) * 100) : 0,
    };
  }).sort((a, b) => b.caixa - a.caixa);

  const th = "text-[10px] uppercase font-semibold tracking-wider";
  const muted = { color: "var(--text2)" };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Análise do Time</h1>
        <p className="text-sm mt-1" style={muted}>Números diretos para preparar a daily. Só gerência.</p>
      </div>

      <MensagemDia />

      <ResumoIA />

      <div className="flex flex-wrap gap-3 items-end"><label className="text-sm">De<input aria-label="De" type="date" className="eda-input" value={customFrom || semana[0]} onChange={e=>setCustomFrom(e.target.value)} /></label><label className="text-sm">Até<input aria-label="Até" type="date" className="eda-input" value={customTo || semana[4]} onChange={e=>setCustomTo(e.target.value)}/></label><label className="text-sm">Base<select className="eda-input" aria-label="Base" value={base} onChange={e=>setBase(e.target.value)}><option value="realizacao">Realização (dia da call)</option><option value="marcacao">Marcação (dia do registo)</option></select></label><Button variant="outline" onClick={()=>{setSemanaOffset(o=>o-1);setCustomFrom('');setCustomTo('');}}>Semana anterior</Button><Button variant="outline" disabled={semanaOffset>=0} onClick={()=>{setSemanaOffset(o=>o+1);setCustomFrom('');setCustomTo('');}}>Semana seguinte</Button></div>
      <CallsAnalysis from={customFrom || semana[0]} to={customTo || semana[4]} base={base}/>
      <section className="eda-card overflow-x-auto">
        <h2 className={th} style={muted}>SDRs · resultados comerciais</h2>
        <table className="w-full text-sm"><thead><tr style={muted}><th className={`${th} py-2 text-left`}>SDR</th><th className={`${th} text-right`}>Bruto</th><th className={`${th} text-right`}>Líquido</th><th className={`${th} text-right`}>Vendas</th><th className={`${th} text-right`}>Ticket médio</th></tr></thead>
          <tbody>{sdrs.map(s => { const r = financeiroSdr?.find(r => r.member_id === s.id) ?? EMPTY_MEMBER; return <tr key={s.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-2">{s.nome}</td><td className="text-right">{eur(r.bruto)}</td><td className="text-right">{eur(r.liquido)}</td><td className="text-right">{r.vendas}</td><td className="text-right">{eur(r.ticket_medio)}</td></tr>; })}</tbody>
        </table>
      </section>

      {/* Closers */}
      <section className="eda-card overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
          <h2 className={th} style={muted}>Closers · caixa gerado</h2>
          <div className="flex flex-wrap items-end gap-3"><PeriodFilter period={periodState} /></div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={muted}>
              <th className={`${th} py-2`}>Closer</th>
              <th className={`${th} text-right`}>Caixa (líquido)</th>
              <th className={`${th} text-right`}>Bruto</th>
              <th className={`${th} text-right`}>Ticket médio</th>
              <th className={`${th} text-right`}>Calls realizadas</th>
              <th className={`${th} text-right`}>Vendas</th>
              <th className={`${th} text-right`}>Conversão</th>
              <th className={`${th} text-right`}>Não compareceu</th>
            </tr>
          </thead>
          <tbody>
            {linhasCloser.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                 <td className="py-2 font-medium"><span className="inline-flex items-center gap-2"><Avatar nome={c.nome} foto={equipaFotos.get(c.id)?.foto_url} size={30} /><span>{c.nome}</span></span></td>
                <td className="text-right font-bold" style={{ color: "var(--green)" }}>{eur(c.caixa)}</td>
                <td className="text-right">{eur(c.bruto)}</td>
                <td className="text-right">{eur(c.ticket)}</td>
                <td className="text-right">{c.realizadas}</td>
                <td className="text-right">{c.vendas}</td>
                <td className="text-right">{c.realizadas ? `${c.conv}%` : "—"}</td>
                <td className="text-right">{c.noshow}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs mt-3" style={{ color: "var(--text3)" }}>Caixa = dinheiro efetivamente recebido no período (mesma regra do dashboard). Calls realizadas são validadas pelo closer.</p>
      </section>
    </div>
  );
}
