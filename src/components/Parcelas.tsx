import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { friendlyError } from "@/lib/rls-error";
import { Campo, Editavel, Modal, Msg, Tabela, TD, Tag, call, tdStyle, useInvalidate } from "@/lib/pagamentos-ui";

/* ---------- Parcelas: uma linha por aluno, uma coluna por parcela ---------- */
const COR_ESTADO: Record<string, string> = { paga: "var(--green)", pendente: "var(--accent)", atrasada: "var(--gold)", cancelada: "var(--red)" };
export function Parcelas({ from, to }: { from: string; to: string }) {
  const inv = useInvalidate();
  const [filtro, setFiltro] = useState("aberto");
  const [soRecorrente, setSoRecorrente] = useState(true);
  const [doMes, setDoMes] = useState(false);
  const [sel, setSel] = useState<any | null>(null);
  const [editar, setEditar] = useState<string | null>(null);
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
  const vendaCancelada = (l: any[]) => ["cancelado", "cancelada"].includes(l[0].venda?.status);
  grupos = grupos.filter((l) => {
    const canc = vendaCancelada(l);
    if (filtro === "cancelada") return canc || l.some((c) => c.estado_calc === "cancelada");
    if (filtro === "todas") return true;
    if (canc) return false;
    if (filtro === "aberto") return l.some(aberta);
    if (filtro === "atrasada") return l.some((c) => c.estado_calc === "atrasada");
    if (filtro === "quitada") return l.every((c) => c.estado_calc === "paga");
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
      <p className="text-[11px]" style={{ color: "var(--text3)" }}>Uma linha por aluno. Clique na parcela para marcar como paga: a comissão dessa parcela é gerada para o SDR e o closer da venda. Os vencimentos seguem a data de início, mês a mês. Use o botão Editar, na linha do aluno, para mudar o número de parcelas, os vencimentos e o total da venda.</p>
      <Tabela head={["Aluno", "Parcelas", "Valor parcela", "Total da venda", ...cols.map((n) => `Parcela ${n}`)]} min={760 + maxN * 110} stickyFirst>
        {grupos.map((l) => {
          const v = l[0].venda; const n = l[0].total_parcelas ?? l.length;
          const pagas = l.filter((c) => c.estado_calc === "paga").length;
          const canc = v && ["cancelado", "cancelada"].includes(v.status);
          return (
            <tr key={l[0].venda_id}>
              <td className={TD + " font-semibold sticky left-0 z-10"} style={{ ...tdStyle, background: "var(--surface)" }}>
                {v?.nome_cliente ?? l[0].nome}{canc && <span className="ml-2"><Tag k="cancelada" /></span>}
                <div className="text-[11px] font-normal" style={{ color: "var(--text3)" }}>Início {fmtDate(l[0].data)}</div>
                <div className="flex gap-1.5 mt-1.5">
                  {!canc && <button className="eda-btn text-[11px] px-2.5 py-1" onClick={() => setEditar(l[0].venda_id)}>Editar</button>}
                  {v && !canc && <button className="eda-btn-ghost text-[11px] px-2.5 py-1" style={{ color: "var(--red)" }} disabled={cancelar.isPending}
                    onClick={() => { if (confirm(`Cancelar a venda de ${v.nome_cliente}? As parcelas pendentes ficam canceladas; as pagas não mudam.`)) cancelar.mutate(l[0].venda_id); }}>Cancelar</button>}
                </div>
              </td>
              <td className={TD} style={tdStyle}>{pagas}/{n} pagas</td>
              <td className={TD} style={tdStyle}>{eur(l[0].valor)}</td>
              <td className={TD} style={tdStyle}>{eur(v?.ticket)}</td>
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
            </tr>
          );
        })}
        {grupos.length === 0 && <tr><td colSpan={4 + maxN} className="px-4 py-6 text-center" style={{ color: "var(--text3)" }}>Nenhum aluno com este filtro. Alunos já quitados estão em "Quitadas" ou "Todas".</td></tr>}
      </Tabela>
      {editar && porVenda.get(editar) && <EditarVenda l={porVenda.get(editar)!} onClose={() => setEditar(null)} />}
      {sel && <PagarModal c={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function EditarVenda({ l, onClose }: { l: any[]; onClose: () => void }) {
  const inv = useInvalidate();
  const v = l[0].venda; const vid = l[0].venda_id;
  const ativas = l.filter((c) => c.estado_calc !== "cancelada");
  const n = ativas[0]?.total_parcelas ?? ativas.length;
  const [nParc, setNParc] = useState(String(n));
  const [total, setTotal] = useState(String(v?.ticket ?? ""));
  const [datas, setDatas] = useState<Record<string, string>>({});
  const run = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => { toast.success("Guardado"); inv(); },
    onError: (e: any) => toast.error(friendlyError(e)),
  });
  return (
    <Modal title={`Editar · ${v?.nome_cliente ?? l[0].nome}`} onClose={onClose}>
      <div className="space-y-6">
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text2)" }}>Número de parcelas</div>
          <div className="flex gap-2 items-center">
            <input type="number" min={1} max={24} className="eda-input w-24" value={nParc} onChange={(e) => setNParc(e.target.value)} />
            <button className="eda-btn text-xs" disabled={run.isPending || Number(nParc) === n || !nParc}
              onClick={() => run.mutate(() => call("fin_alterar_parcelas", { p_venda: vid, p_n: Math.round(Number(nParc)) }))}>Aplicar</button>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text3)" }}>Parcelas pagas não mudam. O que falta pagar é redividido entre as parcelas em aberto.</p>
        </div>
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text2)" }}>Vencimento de cada parcela</div>
          <div className="space-y-2">
            {ativas.map((c) => {
              const aberta = c.estado_calc === "pendente" || c.estado_calc === "atrasada";
              const val = datas[c.id] ?? c.data;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-24">Parcela {c.parcela_num}</span>
                  <span className="w-24" style={{ color: "var(--text2)" }}>{eur(c.valor_recebido ?? c.valor)}</span>
                  {aberta ? (
                    <>
                      <input type="date" className="eda-input" value={val} onChange={(e) => setDatas({ ...datas, [c.id]: e.target.value })} />
                      <button className="eda-btn-ghost text-xs" disabled={run.isPending || !val || val === c.data}
                        onClick={() => run.mutate(() => call("fin_alterar_vencimento", { p_cobranca: c.id, p_data: val }))}>Guardar</button>
                    </>
                  ) : <span style={{ color: "var(--green)" }}>Paga {c.pago_em ? fmtDate(c.pago_em) : ""}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text2)" }}>Total da venda (EUR)</div>
          <div className="flex gap-2 items-center">
            <input type="number" step="0.01" className="eda-input w-32" value={total} onChange={(e) => setTotal(e.target.value)} />
            <button className="eda-btn text-xs" disabled={run.isPending || !total || Number(total) === Number(v?.ticket)}
              onClick={() => run.mutate(() => call("fin_alterar_valor_venda", { p_venda: vid, p_novo: Number(total) }))}>Guardar</button>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text3)" }}>Ao mudar o total, o que falta pagar é redividido entre as parcelas em aberto.</p>
        </div>
      </div>
    </Modal>
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
