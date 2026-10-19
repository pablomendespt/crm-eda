import { monthRange } from "@/lib/period";
import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Campo, Editavel, Modal, Msg, Tabela, TD, Tag, call, tdStyle, useInvalidate } from "@/lib/pagamentos-ui";
import { useProfile } from "@/hooks/useAuth";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { friendlyError } from "@/lib/rls-error";
import { useFinanceSummary, EMPTY_SUMMARY } from "@/lib/finance-reporting";

export const Route = createFileRoute("/_authenticated/pagamentos")({
  head: () => pageMeta("Pagamentos — CRM EDA", "Fixos, comissões e total a pagar por mês no CRM EDA."),
  component: Page,
});

// Todos os números vêm de funções do servidor (fin_*). Nada é somado aqui.
const TABS_GER = [
  ["resumo", "Resumo"], ["fixos", "Fixos e comissões"],
  ["historico", "Histórico"],
] as const;
const TABS_MEMBRO = [["fixos", "Fixos e comissões"]] as const;

const periodo = monthRange;

function Page() {
  const { data: prof, isPending, user, authLoading } = useProfile();
  const ger = !!prof?.isGerencia;
  const [mes, setMes] = useState(todayISO().slice(0, 7));
  const [tab, setTab] = useState<string>("resumo");
  if (authLoading || (user && isPending)) return <Msg>A carregar…</Msg>;
  const tabs = ger ? TABS_GER : TABS_MEMBRO;
  const cur = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  const p = periodo(mes);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pagamentos</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--text2)" }}>
            {ger ? "Fixo, comissões, bónus e o total a pagar a cada pessoa." : "As suas comissões e o seu fixo do mês."}
          </p>
        </div>
        <label className="text-xs" style={{ color: "var(--text2)" }}>
          Mês
          <input type="month" className="eda-input mt-1 block" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={cur === k} onClick={() => setTab(k)}
            className="text-xs px-4 py-2 rounded-full whitespace-nowrap font-semibold"
            style={cur === k ? { background: "var(--accent)", color: "var(--bg)" } : { background: "var(--surface2)", color: "var(--text2)" }}>
            {l}
          </button>
        ))}
      </div>
      {cur === "resumo" && <Resumo {...p} />}
      {cur === "fixos" && <Fixos {...p} ger={ger} />}
      {cur === "historico" && <Historico />}
    </div>
  );
}


function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="eda-kpi">
      <div className="text-[10px] uppercase font-semibold tracking-[.1em]" style={{ color: "var(--text2)" }}>{label}</div>
      <div className="text-2xl font-bold mt-2" style={{ color: tone ?? "var(--text)" }}>{value}</div>
      {hint && <div className="text-[11px] mt-1" style={{ color: "var(--text3)" }}>{hint}</div>}
    </div>
  );
}
/* ---------- Resumo ---------- */
function Resumo({ from, to }: { from: string; to: string }) {
  const r = useFinanceSummary(from, to);
  const { data: profile } = useProfile();
  const pend = useQuery({ queryKey: ["pag", "pendente"], queryFn: () => call<any[]>("fin_resumo_pendente", {}) });
  if (r.isLoading || pend.isLoading) return <Msg>A carregar…</Msg>;
  const x = r.data ?? EMPTY_SUMMARY; const y = pend.data?.[0] ?? {};
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Kpi label="Bruto do mês" value={eur(x.bruto)} hint={`${x.vendas ?? 0} vendas fechadas no mês`} />
      <Kpi label="Líquido (caixa) do mês" value={eur(x.liquido)} tone="var(--green)" hint="Pago no mês das vendas do mês" />
      {profile?.roles.includes("socio") && <Kpi label="Caixa de recorrência" value={eur(x.recorrencia)} hint="Parcelas pagas no mês de vendas anteriores · só sócios" />}
      <Kpi label="Em atraso" value={eur(y.atraso)} tone="var(--gold)" hint="Parcelas vencidas por pagar (hoje)" />
      <Kpi label="A receber" value={eur(y.a_receber)} tone="var(--accent)" hint="Parcelas pendentes ainda por vencer" />
    </div>
  );
}


/* ---------- Comissões (peças usadas em Fixos e comissões) ---------- */
function ComissaoDesde() {
  const inv = useInvalidate();
  const q = useQuery({ queryKey: ["pag", "comissao-desde"], queryFn: async () => {
    const { data, error } = await (supabase.from("fin_config") as any).select("comissao_desde").eq("id", 1).maybeSingle();
    if (error) throw error; return (data?.comissao_desde as string) ?? "";
  } });
  const m = useMutation({
    mutationFn: (d: string) => call("fin_set_comissao_desde", { p_data: d }),
    onSuccess: () => { toast.success("Data atualizada."); inv(); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });
  return (
    <div className="eda-card flex flex-wrap items-end gap-4">
      <label className="text-xs" style={{ color: "var(--text2)" }}>
        Comissão por parcela só para vendas desde
        <input type="date" className="eda-input mt-1 block" key={q.data} defaultValue={q.data}
          onBlur={(e) => e.target.value && e.target.value !== q.data && m.mutate(e.target.value)} />
      </label>
      <p className="text-[11px]" style={{ color: "var(--text3)" }}>Parcelas de vendas anteriores a esta data não geram comissão (já foram pagas sobre o valor total). As comissões já geradas não mudam.</p>
    </div>
  );
}
function DetalheComissao({ id, nome, from, to, onClose }: { id: string; nome: string; from: string; to: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["pag", "det", id, from], queryFn: () => call<any[]>("fin_comissoes_detalhe", { p_member: id, p_from: from, p_to: to }) });
  return (
    <Modal title={`Origem das comissões · ${nome}`} onClose={onClose}>
      {q.isLoading ? <Msg>A carregar…</Msg> : (
        <Tabela head={["Data pagamento", "Aluno", "Produto", "Parcela", "Papel", "Base", "%", "Valor"]} min={640}>
          {(q.data ?? []).map((r) => (
            <tr key={r.id}>
              <td className={TD} style={tdStyle}>{fmtDate(r.data)}</td>
              <td className={TD + " font-semibold"} style={tdStyle}>{r.aluno}</td>
              <td className={TD} style={tdStyle}>{r.produto ?? "—"}</td>
              <td className={TD} style={tdStyle}>{r.parcela}</td>
              <td className={TD} style={tdStyle}>{r.papel}</td>
              <td className={TD} style={tdStyle}>{eur(r.base)}</td>
              <td className={TD} style={tdStyle}>{Number(r.pct)}%</td>
              <td className={TD} style={tdStyle}>{eur(r.valor)}</td>
            </tr>
          ))}
          {(q.data ?? []).length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center" style={{ color: "var(--text3)" }}>Sem comissões neste mês.</td></tr>}
        </Tabela>
      )}
    </Modal>
  );
}

/* ---------- Fixos ---------- */
const REGRA_RYAN = "Caixa próprio < 5.000 EUR = R$1.500 · ≥ 5.000 = R$2.000 · > 7.000 = 497 EUR (substitui)";
function Fixos({ from, to, ger }: { from: string; to: string; ger: boolean }) {
  const inv = useInvalidate();
  const [pagar, setPagar] = useState<any | null>(null);
  const [bonus, setBonus] = useState<any | null>(null);
  const [sel, setSel] = useState<{ id: string; nome: string } | null>(null);
  const q = useQuery({ queryKey: ["pag", "fixos", from], queryFn: () => call<any[]>("fin_fixos_mes", { p_from: from, p_to: to }) });
  const t = useQuery({ queryKey: ["pag", "total", from], queryFn: () => call<any[]>("fin_total_mes", { p_from: from, p_to: to }) });
  const esc = useQuery({ enabled: ger, queryKey: ["pag", "escala", from], queryFn: () => call<any[]>("fin_escala_gabriel", { p_from: from, p_to: to }) });
  if (q.isLoading || t.isLoading) return <Msg>A carregar…</Msg>;
  const fx = new Map((q.data ?? []).map((x) => [x.member_id, x]));
  const tot = new Map((t.data ?? []).map((x) => [x.member_id, x]));
  const ids = [...new Set([...(t.data ?? []).map((x) => x.member_id), ...(q.data ?? []).map((x) => x.member_id)])];
  const linhas = ids.map((id) => ({ id, f: fx.get(id), t: tot.get(id), nome: tot.get(id)?.nome ?? fx.get(id)?.nome }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const temAjustes = linhas.some((l) => Number(l.t?.ajustes) !== 0 && l.t?.ajustes != null);
  const e = esc.data?.[0];
  const head = ["Pessoa", "Fixo", "Fixo pago", "Comissões", "Escala", "Bónus", ...(temAjustes ? ["Ajustes"] : []), "Total a pagar", ""];
  return (
    <div className="space-y-3">
      {ger && <p className="text-[11px]" style={{ color: "var(--text3)" }}>Duplo clique no fixo em BRL para editar. Ao pagar o fixo, digite a cotação do dia (BRL por 1 EUR). Clique nas comissões para ver cada uma. O fixo em BRL só entra no total depois de pago.</p>}
      <Tabela head={head} min={1000}>
        {linhas.map(({ id, f, t: r, nome }) => (
          <tr key={id}>
            <td className={TD + " font-semibold"} style={tdStyle}>{nome}</td>
            <td className={TD} style={{ ...tdStyle, whiteSpace: "normal" }}>
              {!f ? <span style={{ color: "var(--text3)" }}>—</span> : f.valor_eur_fixo != null ? <span>{eur(f.valor_eur_fixo)} <span className="text-[11px]" style={{ color: "var(--text3)" }}>(em EUR)</span></span> :
                <Editavel can={ger && f.regra !== "ryan"} value={f.valor_brl == null ? "" : String(f.valor_brl)}
                  display={f.valor_brl == null ? "por definir" : `R$ ${Number(f.valor_brl).toLocaleString("pt-PT")}`}
                  onSave={async (v) => { await call("fin_set_fixo", { p_member: id, p_valor_brl: v === "" ? null : Number(v), p_regra: f.regra }); inv(); }} />}
              {f?.regra === "ryan" && <div className="text-[11px] mt-1" style={{ color: "var(--text3)" }}>Caixa próprio do mês: <strong>{eur(f.caixa_proprio)}</strong><br />{REGRA_RYAN}</div>}
            </td>
            <td className={TD} style={tdStyle}>
              {!f ? "—" : f.pago_eur == null ? <span style={{ color: "var(--text3)" }}>por pagar</span> : (
                <span>{eur(f.pago_eur)}
                  <div className="text-[11px]" style={{ color: "var(--text3)" }}>{f.cotacao != null ? `cotação ${Number(f.cotacao).toLocaleString("pt-PT")} · ` : ""}{f.data_pagamento ? fmtDate(f.data_pagamento) : ""}</div>
                </span>)}
            </td>
            <td className={TD} style={tdStyle}>
              <button className="hover:underline font-semibold" title="Ver comissão por comissão" onClick={() => setSel({ id, nome })}>{eur(r?.comissoes ?? 0)}</button>
            </td>
            <td className={TD} style={tdStyle}>{Number(r?.escala) ? eur(r?.escala) : "—"}</td>
            <td className={TD} style={tdStyle}>{eur(r?.bonus ?? 0)}</td>
            {temAjustes && <td className={TD} style={{ ...tdStyle, color: Number(r?.ajustes) < 0 ? "var(--red)" : undefined }}>{eur(r?.ajustes ?? 0)}</td>}
            <td className={TD + " font-bold"} style={{ ...tdStyle, color: "var(--green)" }}>{eur(r?.total ?? 0)}</td>
            <td className={TD} style={tdStyle}>
              {ger && (
                <div className="flex gap-2 justify-end">
                  {f && (f.valor_brl != null || f.valor_eur_fixo != null) &&
                    <button className="eda-btn text-xs" onClick={() => setPagar(f)}>{f.pago_eur == null ? "Pagar fixo" : "Corrigir fixo"}</button>}
                  <button className="eda-btn-ghost text-xs" onClick={() => setBonus({ member_id: id, nome })}>+ Bónus</button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
      {ger && e && (
        <div className="eda-card">
          <div className="text-[10px] uppercase font-semibold tracking-[.1em]" style={{ color: "var(--text2)" }}>Escala do Gabriel</div>
          <div className="flex flex-wrap gap-8 mt-2 text-sm">
            <span>Base (caixa do time no mês): <strong>{eur(e.base)}</strong></span>
            <span>Faixa: <strong>{Number(e.pct)}%</strong></span>
            <span>Valor: <strong>{eur(e.valor)}</strong></span>
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--text3)" }}>Faixas: menos de 3.500 = 0% · 3.500 = 2% · 5.000 = 3% · 7.000 = 4% · 9.000 ou mais = 5%.</p>
        </div>
      )}
      {ger && <ComissaoDesde />}
      {pagar && <PagarFixo r={pagar} mes={from} onClose={() => setPagar(null)} />}
      {bonus && <BonusModal r={bonus} mes={from} onClose={() => setBonus(null)} />}
      {sel && <DetalheComissao {...sel} from={from} to={to} onClose={() => setSel(null)} />}
    </div>
  );
}
function PagarFixo({ r, mes, onClose }: { r: any; mes: string; onClose: () => void }) {
  const inv = useInvalidate();
  const emEur = r.valor_eur_fixo != null;
  const [cot, setCot] = useState(r.cotacao ? String(r.cotacao) : "");
  const [data, setData] = useState(todayISO());
  const m = useMutation({
    mutationFn: () => call("fin_pagar_fixo", emEur
      ? { p_member: r.member_id, p_mes: mes, p_valor_brl: null, p_cotacao: null, p_valor_eur: r.valor_eur_fixo, p_data: data }
      : { p_member: r.member_id, p_mes: mes, p_valor_brl: r.valor_brl, p_cotacao: Number(cot.replace(",", ".")), p_valor_eur: null, p_data: data }),
    onSuccess: () => { toast.success("Fixo pago"); inv(); onClose(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  return (
    <Modal title={`Pagar fixo · ${r.nome}`} onClose={onClose}>
      <p className="text-sm mb-4" style={{ color: "var(--text2)" }}>
        {emEur ? `Fixo deste mês: ${eur(r.valor_eur_fixo)} (pago em EUR).` : `Fixo: R$ ${Number(r.valor_brl).toLocaleString("pt-PT")}. O valor em EUR é calculado pelo sistema com a cotação que indicar.`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {!emEur && <Campo l="Cotação do dia (BRL por 1 EUR)"><input inputMode="decimal" className="eda-input" value={cot} onChange={(e) => setCot(e.target.value)} placeholder="Ex.: 6,20" /></Campo>}
        <Campo l="Data do pagamento"><input type="date" className="eda-input" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
      </div>
      <div className="flex justify-end mt-4"><button className="eda-btn" disabled={m.isPending || (!emEur && !cot)} onClick={() => m.mutate()}>Confirmar</button></div>
    </Modal>
  );
}

function BonusModal({ r, mes, onClose }: { r: any; mes: string; onClose: () => void }) {
  const inv = useInvalidate();
  const [v, setV] = useState(""); const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: () => call("fin_registar_bonus", { p_member: r.member_id, p_valor: Number(v.replace(",", ".")), p_mes: mes, p_motivo: motivo || null }),
    onSuccess: () => { toast.success("Bónus registado"); inv(); onClose(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  return (
    <Modal title={`Bónus · ${r.nome}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Campo l="Valor (EUR)"><input inputMode="decimal" className="eda-input" value={v} onChange={(e) => setV(e.target.value)} /></Campo>
        <Campo l="Motivo"><input className="eda-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: meta semanal 25 calls" /></Campo>
      </div>
      <div className="flex justify-end mt-4"><button className="eda-btn" disabled={!v || m.isPending} onClick={() => m.mutate()}>Registar</button></div>
    </Modal>
  );
}

/* ---------- Histórico ---------- */
function Historico() {
  const q = useQuery({
    queryKey: ["pag", "hist"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fin_hist").select("*").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (q.isLoading) return <Msg>A carregar…</Msg>;
  return (
    <Tabela head={["Quando", "Ação", "De", "Para", "Valor", "Quem"]} min={800}>
      {(q.data ?? []).length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center" style={{ color: "var(--text3)" }}>Ainda sem movimentos. Cada pagamento, mudança de vencimento, de valor ou de parcelas fica registado aqui, com quem fez.</td></tr>}
      {(q.data ?? []).map((h: any) => (
        <tr key={h.id}>
          <td className={TD} style={tdStyle}>{new Date(h.created_at).toLocaleString("pt-PT")}</td>
          <td className={TD} style={tdStyle}>{h.acao}</td>
          <td className={TD} style={tdStyle}>{h.de ?? "—"}</td>
          <td className={TD} style={tdStyle}>{h.para ?? "—"}</td>
          <td className={TD} style={tdStyle}>{h.valor == null ? "—" : eur(h.valor)}</td>
          <td className={TD} style={tdStyle}>{h.actor_nome ?? "—"}</td>
        </tr>
      ))}
    </Tabela>
  );
}
