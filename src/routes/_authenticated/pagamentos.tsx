import { monthRange } from "@/lib/period";
import { pageMeta } from "@/lib/page-meta";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { friendlyError } from "@/lib/rls-error";
import { useFinanceSummary, EMPTY_SUMMARY } from "@/lib/finance-reporting";

export const Route = createFileRoute("/_authenticated/pagamentos")({
  head: () => pageMeta("Pagamentos — CRM EDA", "Parcelas, comissões, fixos e total a pagar por mês no CRM EDA."),
  component: Page,
});

// Todos os números vêm de funções do servidor (fin_*). Nada é somado aqui.
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
async function call<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}

const TABS_GER = [
  ["resumo", "Resumo"], ["parcelas", "Parcelas"], ["comissoes", "Comissões"], ["fixos", "Fixos"],
  ["total", "Total do mês"], ["ajustes", "Ajustes"], ["historico", "Histórico"],
] as const;
const TABS_MEMBRO = [["comissoes", "Comissões"], ["fixos", "Fixos"]] as const;

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
            {ger ? "Parcelas, comissões, fixos e o total a pagar a cada pessoa." : "As suas comissões e o seu fixo do mês."}
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
      {cur === "parcelas" && <Parcelas />}
      {cur === "comissoes" && <Comissoes {...p} ger={ger} />}
      {cur === "fixos" && <Fixos {...p} ger={ger} />}
      {cur === "total" && <Total {...p} />}
      {cur === "ajustes" && <Ajustes />}
      {cur === "historico" && <Historico />}
    </div>
  );
}

/* ---------- peças ---------- */
function Msg({ children }: { children: ReactNode }) {
  return <div className="text-sm" style={{ color: "var(--text2)" }}>{children}</div>;
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
function Tabela({ head, children, min = 700 }: { head: string[]; children: ReactNode; min?: number }) {
  return (
    <div className="eda-card p-0 overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead>
          <tr className="text-left text-[11px] uppercase" style={{ color: "var(--text2)", background: "var(--surface2)" }}>
            {head.map((h) => <th key={h} className="px-4 py-3 font-semibold tracking-[.08em] whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const TD = "px-4 py-2.5 border-t whitespace-nowrap";
const tdStyle = { borderColor: "var(--border)" };
const COR: Record<string, string> = { paga: "var(--green)", pendente: "var(--accent)", atrasada: "var(--gold)", cancelada: "var(--red)" };
function Tag({ k }: { k: string }) {
  const c = COR[k] ?? "var(--text3)";
  return <span className="inline-block rounded-full text-[11px] px-2.5 py-1 font-semibold capitalize"
    style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}>{k}</span>;
}

/** Valor editável com duplo clique (só quando `can`). */
function Editavel({ value, display, can, type = "number", onSave }: {
  value: string; display: ReactNode; can: boolean; type?: string; onSave: (v: string) => Promise<unknown>;
}) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState(value);
  if (!can) return <>{display}</>;
  if (!ed) return <span onDoubleClick={() => { setV(value); setEd(true); }} title="Duplo clique para editar" className="cursor-text border-b border-dashed" style={{ borderColor: "var(--text3)" }}>{display}</span>;
  const save = async () => {
    try { await onSave(v); setEd(false); toast.success("Guardado"); } catch (e) { toast.error(friendlyError(e as any)); }
  };
  return <input autoFocus type={type} step="0.01" className="eda-input w-32" value={v} onChange={(e) => setV(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEd(false); }} onBlur={() => setEd(false)} />;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "color-mix(in srgb, var(--bg) 75%, transparent)" }} onClick={onClose}>
      <div className="eda-card w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Fechar" onClick={onClose} className="p-2"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function useInvalidate() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["pag"] }); qc.invalidateQueries({ queryKey: ["finance"] }); };
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

/* ---------- Parcelas ---------- */
function Parcelas() {
  const inv = useInvalidate();
  const [filtro, setFiltro] = useState("todas");
  const [pagar, setPagar] = useState<any | null>(null);
  const q = useQuery({
    queryKey: ["pag", "parcelas"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("cobrancas_estado")
        .select("*, venda:vendas(id, nome_cliente, produto, ticket, status)").order("data", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const cancelar = useMutation({
    mutationFn: (venda: string) => call("fin_cancelar_venda", { p_venda: venda }),
    onSuccess: () => { toast.success("Venda cancelada"); inv(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  if (q.isLoading) return <Msg>A carregar…</Msg>;
  const rows = (q.data ?? []).filter((c) => filtro === "todas" || c.estado_calc === filtro);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          {["todas", "paga", "pendente", "atrasada", "cancelada"].map((f) => (
            <button key={f} onClick={() => setFiltro(f)} className="text-xs px-3 py-1.5 rounded-full capitalize"
              style={filtro === f ? { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--accent)" } : { background: "var(--surface2)", color: "var(--text2)" }}>{f}</button>
          ))}
        </div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text3)" }}>Duplo clique no vencimento ou no valor total da venda para editar. Uma venda com parcelas atrasadas continua ativa até a gerência a cancelar.</p>
      <Tabela head={["Aluno", "Produto", "Parcela", "Valor", "Total da venda", "Vencimento", "Estado", "Pago em", ""]} min={1000}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className={TD + " font-semibold"} style={tdStyle}>{c.venda?.nome_cliente ?? c.nome}</td>
            <td className={TD} style={{ ...tdStyle, color: "var(--text2)" }}>{c.venda?.produto ?? "—"}</td>
            <td className={TD} style={tdStyle}>{c.parcela_num}/{c.total_parcelas}</td>
            <td className={TD} style={tdStyle}>{eur(c.valor)}</td>
            <td className={TD} style={tdStyle}>
              <Editavel can value={String(c.venda?.ticket ?? "")} display={eur(c.venda?.ticket)}
                onSave={async (v) => { await call("fin_alterar_valor_venda", { p_venda: c.venda_id, p_novo: Number(v) }); inv(); }} />
            </td>
            <td className={TD} style={tdStyle}>
              <Editavel can={c.estado_calc !== "paga"} type="date" value={c.data} display={fmtDate(c.data)}
                onSave={async (v) => { await call("fin_alterar_vencimento", { p_cobranca: c.id, p_data: v }); inv(); }} />
              {c.dias_atraso > 0 && <span className="text-[11px] ml-2" style={{ color: "var(--gold)" }}>{c.dias_atraso} dias</span>}
            </td>
            <td className={TD} style={tdStyle}><Tag k={c.estado_calc} /></td>
            <td className={TD} style={tdStyle}>{c.pago_em ? fmtDate(c.pago_em) : "—"}</td>
            <td className={TD} style={tdStyle}>
              <div className="flex gap-2 justify-end">
              {(c.estado_calc === "pendente" || c.estado_calc === "atrasada") &&
                <button className="eda-btn text-xs" onClick={() => setPagar(c)}>Marcar paga</button>}
              {c.venda && !["cancelado", "cancelada"].includes(c.venda.status) &&
                <button className="eda-btn-ghost text-xs" style={{ color: "var(--red)" }} disabled={cancelar.isPending}
                  onClick={() => { if (confirm(`Cancelar a venda de ${c.venda.nome_cliente}? As parcelas pendentes ficam canceladas; as pagas não mudam.`)) cancelar.mutate(c.venda_id); }}>Cancelar venda</button>}
              </div>
            </td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center" style={{ color: "var(--text3)" }}>Sem parcelas.</td></tr>}
      </Tabela>
      {pagar && <PagarModal c={pagar} onClose={() => setPagar(null)} />}
    </div>
  );
}

function PagarModal({ c, onClose }: { c: any; onClose: () => void }) {
  const inv = useInvalidate();
  const [f, setF] = useState({ valor: String(c.valor), data: todayISO(), metodo: "Pagamento Recorrente", conta: "", obs: "" });
  const m = useMutation({
    mutationFn: () => call("fin_registar_pagamento", { p_cobranca: c.id, p_valor: Number(f.valor), p_data: f.data, p_metodo: f.metodo, p_conta: f.conta || null, p_obs: f.obs || null }),
    onSuccess: () => { toast.success("Pagamento registado"); inv(); onClose(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  return (
    <Modal title={`Registar pagamento · ${c.venda?.nome_cliente ?? c.nome} ${c.parcela_num}/${c.total_parcelas}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Campo l="Valor (EUR)"><input type="number" step="0.01" className="eda-input" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Campo>
        <Campo l="Data"><input type="date" className="eda-input" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Campo>
        <Campo l="Método"><select className="eda-input" value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>
          {["Pagamento Recorrente", "Cartão - à vista", "MB Way", "Dinheiro", "Transferência", "Klarna"].map((o) => <option key={o}>{o}</option>)}</select></Campo>
        <Campo l="Conta"><input className="eda-input" value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })} placeholder="Ex.: MB Way — Pablo" /></Campo>
        <div className="col-span-2"><Campo l="Observação"><input className="eda-input" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></Campo></div>
      </div>
      <div className="flex justify-end mt-4"><button className="eda-btn" disabled={m.isPending} onClick={() => m.mutate()}>Confirmar pagamento</button></div>
    </Modal>
  );
}
function Campo({ l, children }: { l: string; children: ReactNode }) {
  return <label className="block text-xs font-medium space-y-1" style={{ color: "var(--text2)" }}><span>{l}</span>{children}</label>;
}

/* ---------- Comissões ---------- */
function Comissoes({ from, to, ger }: { from: string; to: string; ger: boolean }) {
  const [sel, setSel] = useState<{ id: string; nome: string } | null>(null);
  const t = useQuery({ queryKey: ["pag", "total", from], queryFn: () => call<any[]>("fin_total_mes", { p_from: from, p_to: to }) });
  const esc = useQuery({ enabled: ger, queryKey: ["pag", "escala", from], queryFn: () => call<any[]>("fin_escala_gabriel", { p_from: from, p_to: to }) });
  if (t.isLoading) return <Msg>A carregar…</Msg>;
  const e = esc.data?.[0];
  return (
    <div className="space-y-4">
      <Tabela head={["Pessoa", "Comissões do mês", "Escala"]} min={500}>
        {(t.data ?? []).map((r) => (
          <tr key={r.member_id}>
            <td className={TD + " font-semibold"} style={tdStyle}><button className="hover:underline" onClick={() => setSel({ id: r.member_id, nome: r.nome })}>{r.nome}</button></td>
            <td className={TD} style={tdStyle}>{eur(r.comissoes)}</td>
            <td className={TD} style={tdStyle}>{Number(r.escala) ? eur(r.escala) : "—"}</td>
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
      {sel && <DetalheComissao {...sel} from={from} to={to} onClose={() => setSel(null)} />}
    </div>
  );
}
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
  const q = useQuery({ queryKey: ["pag", "fixos", from], queryFn: () => call<any[]>("fin_fixos_mes", { p_from: from, p_to: to }) });
  if (q.isLoading) return <Msg>A carregar…</Msg>;
  return (
    <div className="space-y-3">
      {ger && <p className="text-[11px]" style={{ color: "var(--text3)" }}>Duplo clique no fixo em BRL para editar. Ao pagar, digite a cotação do dia (BRL por 1 EUR).</p>}
      <Tabela head={["Pessoa", "Fixo (BRL)", "Regra", "Pago (EUR)", "Cotação", "Data", ""]} min={900}>
        {(q.data ?? []).map((r) => (
          <tr key={r.member_id}>
            <td className={TD + " font-semibold"} style={tdStyle}>{r.nome}</td>
            <td className={TD} style={tdStyle}>
              {r.valor_eur_fixo != null ? <span>{eur(r.valor_eur_fixo)} <span className="text-[11px]" style={{ color: "var(--text3)" }}>(em EUR)</span></span> :
                <Editavel can={ger && r.regra !== "ryan"} value={r.valor_brl == null ? "" : String(r.valor_brl)}
                  display={r.valor_brl == null ? "por definir" : `R$ ${Number(r.valor_brl).toLocaleString("pt-PT")}`}
                  onSave={async (v) => { await call("fin_set_fixo", { p_member: r.member_id, p_valor_brl: v === "" ? null : Number(v), p_regra: r.regra }); inv(); }} />}
            </td>
            <td className={TD} style={{ ...tdStyle, color: "var(--text2)", whiteSpace: "normal" }}>
              {r.regra === "ryan" ? <span className="text-xs">Caixa próprio do mês: <strong>{eur(r.caixa_proprio)}</strong><br />{REGRA_RYAN}</span> : "Fixo mensal"}
            </td>
            <td className={TD} style={tdStyle}>{r.pago_eur == null ? "—" : eur(r.pago_eur)}</td>
            <td className={TD} style={tdStyle}>{r.cotacao == null ? "—" : Number(r.cotacao).toLocaleString("pt-PT")}</td>
            <td className={TD} style={tdStyle}>{r.data_pagamento ? fmtDate(r.data_pagamento) : "—"}</td>
            <td className={TD} style={tdStyle}>
              {ger && (r.valor_brl != null || r.valor_eur_fixo != null) &&
                <button className="eda-btn text-xs" onClick={() => setPagar(r)}>{r.pago_eur == null ? "Pagar" : "Corrigir"}</button>}
            </td>
          </tr>
        ))}
      </Tabela>
      {pagar && <PagarFixo r={pagar} mes={from} onClose={() => setPagar(null)} />}
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

/* ---------- Total do mês ---------- */
function Total({ from, to }: { from: string; to: string }) {
  const [bonus, setBonus] = useState<any | null>(null);
  const q = useQuery({ queryKey: ["pag", "total", from], queryFn: () => call<any[]>("fin_total_mes", { p_from: from, p_to: to }) });
  if (q.isLoading) return <Msg>A carregar…</Msg>;
  return (
    <>
      <Tabela head={["Pessoa", "Fixo (EUR)", "Comissões", "Escala", "Bónus", "Ajustes", "Total a pagar", ""]} min={900}>
        {(q.data ?? []).map((r) => (
          <tr key={r.member_id}>
            <td className={TD + " font-semibold"} style={tdStyle}>{r.nome}</td>
            <td className={TD} style={tdStyle}>{r.fixo_eur == null ? <span style={{ color: "var(--text3)" }}>por pagar</span> : eur(r.fixo_eur)}{r.fixo_eur != null && !r.fixo_pago && <span className="text-[11px] ml-1" style={{ color: "var(--text3)" }}>(previsto)</span>}</td>
            <td className={TD} style={tdStyle}>{eur(r.comissoes)}</td>
            <td className={TD} style={tdStyle}>{eur(r.escala)}</td>
            <td className={TD} style={tdStyle}>{eur(r.bonus)}</td>
            <td className={TD} style={{ ...tdStyle, color: Number(r.ajustes) < 0 ? "var(--red)" : undefined }}>{eur(r.ajustes)}</td>
            <td className={TD + " font-bold"} style={{ ...tdStyle, color: "var(--green)" }}>{eur(r.total)}</td>
            <td className={TD} style={tdStyle}><button className="eda-btn-ghost text-xs" onClick={() => setBonus(r)}>+ Bónus</button></td>
          </tr>
        ))}
      </Tabela>
      <p className="text-[11px]" style={{ color: "var(--text3)" }}>O fixo em BRL só entra no total depois de pago com a cotação do dia.</p>
      {bonus && <BonusModal r={bonus} mes={from} onClose={() => setBonus(null)} />}
    </>
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

/* ---------- Ajustes ---------- */
const DECIDIDO = ["aplicar", "parcial", "nao_aplicar"];
function Ajustes() {
  const inv = useInvalidate();
  const q = useQuery({
    queryKey: ["pag", "ajustes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fin_ajustes").select("*, member:members(nome), venda:vendas(nome_cliente)").neq("tipo", "bonus").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const decidir = async (id: string, d: string, sug: number) => {
    let valor: number | null = null;
    if (d === "parcial") {
      const s = window.prompt(`Valor do ajuste (sugerido ${eur(sug)})`);
      if (!s) return; valor = Number(s.replace(",", "."));
    }
    try { await call("fin_decidir_ajuste", { p_id: id, p_decisao: d, p_valor: valor }); toast.success("Decisão registada"); inv(); }
    catch (e) { toast.error(friendlyError(e as any)); }
  };
  if (q.isLoading) return <Msg>A carregar…</Msg>;
  return (
    <Tabela head={["Data", "Tipo", "Aluno", "Pessoa", "Devolvido", "Comissão paga", "Sugerido", "Decisão", ""]} min={1000}>
      {(q.data ?? []).map((a) => (
        <tr key={a.id}>
          <td className={TD} style={tdStyle}>{fmtDate(a.data)}</td>
          <td className={TD} style={tdStyle}>{a.tipo}</td>
          <td className={TD} style={tdStyle}>{a.venda?.nome_cliente ?? "—"}</td>
          <td className={TD} style={tdStyle}>{a.member?.nome ?? "—"}</td>
          <td className={TD} style={tdStyle}>{eur(a.valor_devolvido)}</td>
          <td className={TD} style={tdStyle}>{eur(a.comissao_paga)}</td>
          <td className={TD} style={tdStyle}>{eur(a.ajuste_sugerido)}</td>
          <td className={TD} style={tdStyle}>{DECIDIDO.includes(a.decisao) ? `${a.decisao} (${eur(a.valor_ajuste)})` : "Pendente"}</td>
          <td className={TD} style={tdStyle}>
            {!DECIDIDO.includes(a.decisao) && (
              <div className="flex gap-1">
                <button className="eda-btn text-xs" onClick={() => decidir(a.id, "aplicar", a.ajuste_sugerido)}>Aplicar</button>
                <button className="eda-btn-ghost text-xs" onClick={() => decidir(a.id, "parcial", a.ajuste_sugerido)}>Parcial</button>
                <button className="eda-btn-ghost text-xs" onClick={() => decidir(a.id, "nao_aplicar", a.ajuste_sugerido)}>Não aplicar</button>
              </div>
            )}
          </td>
        </tr>
      ))}
      {(q.data ?? []).length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center" style={{ color: "var(--text3)" }}>Sem reembolsos nem chargebacks.</td></tr>}
    </Tabela>
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
