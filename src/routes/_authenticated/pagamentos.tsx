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
  ["resumo", "Resumo"], ["parcelas", "Parcelas"], ["fixos", "Fixos e comissões"],
  ["total", "Total do mês"], ["historico", "Histórico"],
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
      {cur === "parcelas" && <Parcelas {...p} />}
      {cur === "fixos" && <Fixos {...p} ger={ger} />}
      {cur === "total" && <Total {...p} />}
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

/* ---------- Parcelas: uma linha por aluno, uma coluna por parcela ---------- */
const COR_ESTADO: Record<string, string> = { paga: "var(--green)", pendente: "var(--accent)", atrasada: "var(--gold)", cancelada: "var(--red)" };
function Parcelas({ from, to }: { from: string; to: string }) {
  const inv = useInvalidate();
  const [filtro, setFiltro] = useState("aberto");
  const [soRecorrente, setSoRecorrente] = useState(true);
  const [doMes, setDoMes] = useState(false);
  const [sel, setSel] = useState<any | null>(null);
  const q = useQuery({
    queryKey: ["pag", "parcelas"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("cobrancas_estado")
        .select("*, venda:vendas(id, nome_cliente, produto, ticket, status, data)").order("data", { ascending: true });
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
  const porVenda = new Map<string, any[]>();
  for (const c of q.data ?? []) { const a = porVenda.get(c.venda_id) ?? []; a.push(c); porVenda.set(c.venda_id, a); }
  let grupos = [...porVenda.values()].map((l) => l.sort((x, y) => x.parcela_num - y.parcela_num));
  if (soRecorrente) grupos = grupos.filter((l) => (l[0].total_parcelas ?? 1) > 1);
  if (doMes) grupos = grupos.filter((l) => l.some((c) => c.data >= from && c.data <= to));
  const aberta = (c: any) => c.estado_calc === "pendente" || c.estado_calc === "atrasada";
  grupos = grupos.filter((l) => {
    if (filtro === "aberto") return l.some(aberta);
    if (filtro === "atrasada") return l.some((c) => c.estado_calc === "atrasada");
    if (filtro === "quitada") return l.every((c) => c.estado_calc === "paga");
    if (filtro === "cancelada") return l.some((c) => c.estado_calc === "cancelada");
    return true;
  });
  grupos.sort((x, y) => String(x[0].data).localeCompare(String(y[0].data)));
  const maxN = Math.max(3, ...grupos.map((l) => l[0].total_parcelas ?? l.length));
  const cols = Array.from({ length: maxN }, (_, i) => i + 1);
  const FILTROS: [string, string][] = [["aberto", "Com parcela em aberto"], ["atrasada", "Atrasadas"], ["quitada", "Quitadas"], ["cancelada", "Canceladas"], ["todas", "Todas"]];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map(([f, l]) => (
            <button key={f} onClick={() => setFiltro(f)} className="text-xs px-3 py-1.5 rounded-full"
              style={filtro === f ? { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--accent)" } : { background: "var(--surface2)", color: "var(--text2)" }}>{l}</button>
          ))}
        </div>
        <div className="flex gap-4 text-xs" style={{ color: "var(--text2)" }}>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={soRecorrente} onChange={(e) => setSoRecorrente(e.target.checked)} /> Só recorrentes</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={doMes} onChange={(e) => setDoMes(e.target.checked)} /> Só quem vence no mês escolhido</label>
        </div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text3)" }}>Uma linha por aluno. Clique na parcela para marcar como paga: a comissão dessa parcela é gerada para o SDR e o closer da venda. Os vencimentos seguem a data de início, mês a mês. Duplo clique em "pagas" para mudar o número de parcelas (o que falta pagar é redistribuído).</p>
      <Tabela head={["Aluno", "Produto", "Início", "Parcelas", "Valor parcela", "Total da venda", ...cols.map((n) => `Parcela ${n}`), ""]} min={900 + maxN * 110}>
        {grupos.map((l) => {
          const v = l[0].venda; const n = l[0].total_parcelas ?? l.length;
          const pagas = l.filter((c) => c.estado_calc === "paga").length;
          const canc = v && ["cancelado", "cancelada"].includes(v.status);
          return (
            <tr key={l[0].venda_id}>
              <td className={TD + " font-semibold"} style={tdStyle}>{v?.nome_cliente ?? l[0].nome}{canc && <span className="ml-2"><Tag k="cancelada" /></span>}</td>
              <td className={TD} style={{ ...tdStyle, color: "var(--text2)" }}>{v?.produto ?? "—"}</td>
              <td className={TD} style={tdStyle}>{fmtDate(l[0].data)}</td>
              <td className={TD} style={tdStyle}>
                <Editavel can={!canc} value={String(n)} display={`${pagas}/${n} pagas`}
                  onSave={async (x) => { await call("fin_alterar_parcelas", { p_venda: l[0].venda_id, p_n: Math.round(Number(x)) }); inv(); }} />
              </td>
              <td className={TD} style={tdStyle}>{eur(l[0].valor)}</td>
              <td className={TD} style={tdStyle}>
                <Editavel can value={String(v?.ticket ?? "")} display={eur(v?.ticket)}
                  onSave={async (x) => { await call("fin_alterar_valor_venda", { p_venda: l[0].venda_id, p_novo: Number(x) }); inv(); }} />
              </td>
              {cols.map((num) => {
                const c = l.find((x) => x.parcela_num === num);
                if (!c) return <td key={num} className={TD} style={{ ...tdStyle, color: "var(--text3)" }}>—</td>;
                const cor = COR_ESTADO[c.estado_calc] ?? "var(--text3)";
                return (
                  <td key={num} className={TD} style={tdStyle}>
                    <button className="rounded-lg px-2.5 py-1 text-left text-[11px] font-semibold leading-tight" onClick={() => setSel(c)}
                      title={c.estado_calc === "paga" ? "Paga" : "Clique para marcar como paga ou mudar o vencimento"}
                      style={{ color: cor, background: `color-mix(in srgb, ${cor} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${cor} 35%, transparent)` }}>
                      <span className="capitalize">{c.estado_calc}</span><br />
                      <span style={{ fontWeight: 500 }}>{c.estado_calc === "paga" && c.pago_em ? fmtDate(c.pago_em) : fmtDate(c.data)}</span>
                      {c.dias_atraso > 0 && <span> · {c.dias_atraso}d</span>}
                    </button>
                  </td>
                );
              })}
              <td className={TD} style={tdStyle}>
                {v && !canc && <button className="eda-btn-ghost text-xs" style={{ color: "var(--red)" }} disabled={cancelar.isPending}
                  onClick={() => { if (confirm(`Cancelar a venda de ${v.nome_cliente}? As parcelas pendentes ficam canceladas; as pagas não mudam.`)) cancelar.mutate(l[0].venda_id); }}>Cancelar venda</button>}
              </td>
            </tr>
          );
        })}
        {grupos.length === 0 && <tr><td colSpan={7 + maxN} className="px-4 py-6 text-center" style={{ color: "var(--text3)" }}>Nenhum aluno com este filtro.</td></tr>}
      </Tabela>
      {sel && <PagarModal c={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function PagarModal({ c, onClose }: { c: any; onClose: () => void }) {
  const inv = useInvalidate();
  const paga = c.estado_calc === "paga" || c.estado_calc === "cancelada";
  const [f, setF] = useState({ valor: String(c.valor), data: todayISO(), metodo: "Pagamento Recorrente", conta: "", obs: "" });
  const [venc, setVenc] = useState<string>(c.data);
  const m = useMutation({
    mutationFn: () => call("fin_registar_pagamento", { p_cobranca: c.id, p_valor: Number(f.valor), p_data: f.data, p_metodo: f.metodo, p_conta: f.conta || null, p_obs: f.obs || null }),
    onSuccess: () => { toast.success("Pagamento registado. Comissão gerada."); inv(); onClose(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  const mv = useMutation({
    mutationFn: () => call("fin_alterar_vencimento", { p_cobranca: c.id, p_data: venc }),
    onSuccess: () => { toast.success("Vencimento atualizado"); inv(); onClose(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  const nome = c.venda?.nome_cliente ?? c.nome;
  if (paga) return (
    <Modal title={`${nome} · parcela ${c.parcela_num}/${c.total_parcelas}`} onClose={onClose}>
      <p className="text-sm" style={{ color: "var(--text2)" }}>
        {c.estado_calc === "paga" ? `Paga ${c.pago_em ? "em " + fmtDate(c.pago_em) : ""} · ${eur(c.valor_recebido ?? c.valor)}.` : "Parcela cancelada."}
      </p>
    </Modal>
  );
  return (
    <Modal title={`Registar pagamento · ${nome} ${c.parcela_num}/${c.total_parcelas}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Campo l="Valor (EUR)"><input type="number" step="0.01" className="eda-input" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Campo>
        <Campo l="Data do pagamento"><input type="date" className="eda-input" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Campo>
        <Campo l="Método"><select className="eda-input" value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>
          {["Pagamento Recorrente", "Cartão - à vista", "MB Way", "Dinheiro", "Transferência", "Klarna"].map((o) => <option key={o}>{o}</option>)}</select></Campo>
        <Campo l="Conta"><input className="eda-input" value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })} placeholder="Ex.: MB Way — Pablo" /></Campo>
        <div className="col-span-2"><Campo l="Observação"><input className="eda-input" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></Campo></div>
      </div>
      <div className="flex justify-end mt-4"><button className="eda-btn" disabled={m.isPending} onClick={() => m.mutate()}>Confirmar pagamento</button></div>
      <div className="mt-6 pt-4 border-t flex flex-wrap items-end gap-3" style={{ borderColor: "var(--border)" }}>
        <Campo l="Mudar o vencimento desta parcela"><input type="date" className="eda-input" value={venc} onChange={(e) => setVenc(e.target.value)} /></Campo>
        <button className="eda-btn-ghost text-xs" disabled={mv.isPending || !venc || venc === c.data} onClick={() => mv.mutate()}>Guardar vencimento</button>
      </div>
    </Modal>
  );
}
function Campo({ l, children }: { l: string; children: ReactNode }) {
  return <label className="block text-xs font-medium space-y-1" style={{ color: "var(--text2)" }}><span>{l}</span>{children}</label>;
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
  const [sel, setSel] = useState<{ id: string; nome: string } | null>(null);
  const q = useQuery({ queryKey: ["pag", "fixos", from], queryFn: () => call<any[]>("fin_fixos_mes", { p_from: from, p_to: to }) });
  const t = useQuery({ queryKey: ["pag", "total", from], queryFn: () => call<any[]>("fin_total_mes", { p_from: from, p_to: to }) });
  const esc = useQuery({ enabled: ger, queryKey: ["pag", "escala", from], queryFn: () => call<any[]>("fin_escala_gabriel", { p_from: from, p_to: to }) });
  if (q.isLoading || t.isLoading) return <Msg>A carregar…</Msg>;
  const tot = new Map((t.data ?? []).map((x) => [x.member_id, x]));
  const e = esc.data?.[0];
  return (
    <div className="space-y-3">
      {ger && <p className="text-[11px]" style={{ color: "var(--text3)" }}>Duplo clique no fixo em BRL para editar. Ao pagar, digite a cotação do dia (BRL por 1 EUR).</p>}
      <Tabela head={["Pessoa", "Fixo (BRL)", "Regra", "Pago (EUR)", "Cotação", "Data", "Comissões do mês", "Escala", ""]} min={1100}>
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
              <button className="hover:underline font-semibold" title="Ver comissão por comissão" onClick={() => setSel({ id: r.member_id, nome: r.nome })}>{eur(tot.get(r.member_id)?.comissoes ?? 0)}</button>
            </td>
            <td className={TD} style={tdStyle}>{Number(tot.get(r.member_id)?.escala) ? eur(tot.get(r.member_id)?.escala) : "—"}</td>
            <td className={TD} style={tdStyle}>
              {ger && (r.valor_brl != null || r.valor_eur_fixo != null) &&
                <button className="eda-btn text-xs" onClick={() => setPagar(r)}>{r.pago_eur == null ? "Pagar" : "Corrigir"}</button>}
            </td>
          </tr>
        ))}
      </Tabela>
      <p className="text-[11px]" style={{ color: "var(--text3)" }}>Clique no valor das comissões para ver cada comissão (aluno, parcela, base, % e valor).</p>
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
