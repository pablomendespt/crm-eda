import {useCallsSummary, EMPTY_CALLS} from '@/lib/calls-reporting';
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate, pct } from "@/lib/format";
import { useFinanceMembers, financeRpc, EMPTY_MEMBER, type FinanceSeries } from "@/lib/finance-reporting";
import { useProfile } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/membros/$id")({
  component: MemberPage,
});

type CloserRow = {
  id: string;
  data: string;
  calls_recebidas: number;
  calls_realizadas: number;
  calls_noshow: number;
  calls_remarcadas: number;
  vendas_fechadas: number;
  valor_vendido: number | string;
  valor_recebido: number | string;
};

type SdrRow = {
  id: string;
  data: string;
  conversas_iniciadas: number;
  respostas_1a: number;
  ligacoes_feitas: number;
  calls_marcadas: number;
  leads_qualificados: number;
  vendas_das_calls: number;
  vendas_diretas: number;
  valor_venda: number | string;
  valor_pago: number | string;
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function inicioMes() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, 1);
}

function endOfMonth() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return iso(d.getFullYear(), d.getMonth() + 1, last);
}

function MemberPage() {
  const { id } = Route.useParams();
  const { data: profile } = useProfile();

  const { data: member } = useQuery({
    queryKey: ["members", id],
    queryFn: async () => {
      const { data } = await supabase.from("members").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data: closerRows } = useQuery({
    queryKey: ["closer_daily", "membro", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("closer_daily")
        .select("*")
        .eq("member_id", id)
        .gte("data", inicioMes())
        .lte("data", endOfMonth())
        .order("data", { ascending: false });
      return (data ?? []) as unknown as CloserRow[];
    },
  });

  const { data: sdrRows } = useQuery({
    queryKey: ["sdr_daily", "membro", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("sdr_daily")
        .select("*")
        .eq("member_id", id)
        .gte("data", inicioMes())
        .lte("data", endOfMonth())
        .order("data", { ascending: false });
      return (data ?? []) as unknown as SdrRow[];
    },
  });

  const {data:callResumo=EMPTY_CALLS}=useCallsSummary(inicioMes(),endOfMonth(),member?.role==='sdr'?id:null,member?.role==='sdr'?null:id);
  const product = member?.role === "cs" ? "PVE" : "";
  const { data: financeiro } = useFinanceMembers(inicioMes(), endOfMonth(), member?.role === "sdr" ? "sdr" : "closer", product);
  const { data: dailyFinance } = useQuery({ queryKey: ["finance", "member-days", id, product],
    queryFn: () => financeRpc<FinanceSeries[]>("fin_series_membro", { p_from: inicioMes(), p_to: endOfMonth(), p_member: id, p_papel: member?.role === "sdr" ? "sdr" : "closer", p_produto: product || null }) });
  const byDay = new Map((dailyFinance ?? []).map(r => [r.inicio, r]));

  if (profile && profile.role !== "socio") {
    return (
      <div className="eda-card">
        <h1 className="text-xl font-bold">Sem acesso</h1>
        <p className="text-sm mt-2" style={{ color: "var(--text2)" }}>
          Esta área é restrita a Sócios.
        </p>
      </div>
    );
  }

  if (!member) return <div className="text-sm" style={{ color: "var(--text3)" }}>A carregar...</div>;

  const c = closerRows ?? [];
  const s = sdrRows ?? [];
  const isCloser = member.role !== "sdr";

  const financial = financeiro?.find(r => r.member_id === id) ?? EMPTY_MEMBER;
  const faturado = financial.bruto;
  const recebido = financial.liquido;
  const nVendas = financial.vendas;

  const callsRealizadas = callResumo.realizadas;
  const callsNaoCompareceu = callResumo.nao_compareceu;
  const callsMarc = callResumo.marcadas;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{member.nome}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          <span className="uppercase">{member.role}</span> · Comissão {Number(member.comissao_pct)}%
          {member.is_founder && <span style={{ color: "var(--gold)" }}> · Fundador</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="eda-kpi"><div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Vendas mês</div><div className="text-xl font-bold mt-2">{nVendas}</div></div>
        <div className="eda-kpi"><div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Faturação</div><div className="text-xl font-bold mt-2" style={{ color: "var(--green)" }}>{eur(faturado)}</div></div>
        <div className="eda-kpi"><div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Recebido</div><div className="text-xl font-bold mt-2" style={{ color: "var(--green)" }}>{eur(recebido)}</div></div>
        <div className="eda-kpi"><div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>{isCloser ? "Calls recebidas" : "Calls marcadas"}</div><div className="text-xl font-bold mt-2">{callsMarc}</div></div>
        {isCloser ? (
          <div className="eda-kpi"><div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Não Compareceu</div><div className="text-xl font-bold mt-2" style={{ color: "var(--gold)" }}>{callsNaoCompareceu} <span className="text-sm">({pct(callsNaoCompareceu, callsRealizadas + callsNaoCompareceu)})</span></div></div>
        ) : (
          <div className="eda-kpi"><div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Conversas iniciadas</div><div className="text-xl font-bold mt-2">{s.reduce((a, r) => a + (r.conversas_iniciadas || 0), 0)}</div></div>
        )}
      </div>

      {c.length > 0 && (
        <div className="eda-card">
          <h3 className="font-semibold mb-3">Atividade histórica — Closer (contadores anteriores)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
                  <th className="py-2">Dia</th><th>Recebidas</th><th>Realizadas</th><th>Não Compareceu</th><th>Remarcadas</th><th>Vendas</th><th>Valor</th><th>Recebido</th>
                </tr>
              </thead>
              <tbody>
                {c.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5">{fmtDate(r.data)}</td>
                    <td>{r.calls_recebidas}</td>
                    <td>{r.calls_realizadas}</td>
                    <td style={{ color: r.calls_noshow > 0 ? "var(--gold)" : "var(--text2)" }}>{r.calls_noshow}</td>
                    <td>{r.calls_remarcadas}</td>
                    <td className="font-semibold">{byDay.get(r.data)?.vendas ?? 0}</td>
                    <td style={{ color: "var(--green)" }}>{eur(byDay.get(r.data)?.bruto ?? 0)}</td>
                    <td style={{ color: "var(--green)" }}>{eur(byDay.get(r.data)?.liquido ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {s.length > 0 && (
        <div className="eda-card">
          <h3 className="font-semibold mb-3">Atividade histórica — SDR (contadores anteriores)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
                  <th className="py-2">Dia</th><th>Conversas</th><th>Respostas</th><th>Ligações</th><th>Calls marc.</th><th>Qualificados</th><th>Vendas</th><th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {s.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5">{fmtDate(r.data)}</td>
                    <td>{r.conversas_iniciadas}</td>
                    <td>{r.respostas_1a}</td>
                    <td>{r.ligacoes_feitas}</td>
                    <td>{r.calls_marcadas}</td>
                    <td>{r.leads_qualificados}</td>
                    <td className="font-semibold">{(r.vendas_das_calls || 0) + (r.vendas_diretas || 0)}</td>
                    <td style={{ color: "var(--green)" }}>{eur(byDay.get(r.data)?.bruto ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {c.length === 0 && s.length === 0 && (
        <div className="eda-card py-8 text-center text-sm" style={{ color: "var(--text3)" }}>
          Sem registos diários este mês.
        </div>
      )}
    </div>
  );
}
