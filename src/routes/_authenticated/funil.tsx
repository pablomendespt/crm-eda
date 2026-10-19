import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Phone, MessageCircle, CalendarClock, X, Trash2, RotateCcw, UserX, Ban, Clock, Flame, Instagram } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Modal, Campo } from "@/lib/pagamentos-ui";
import { Avatar } from "@/components/Avatar";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import {
  ETAPAS, ETAPA_POR_KEY, ORIGENS, rpc, msgErro, useFunilCards, useFunilPapel, useFunilRealtime, podeIrPara, diasDesde,
  fmtHora, fmtDiaCurto, hojeISO, type Card, type Etapa,
} from "@/lib/funil";

export const Route = createFileRoute("/_authenticated/funil")({ component: FunilPage });

const eur = (n: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
const TEMP_COR: Record<string, string> = { Quente: "#ef4444", Morno: "#eab308", Frio: "#3b82f6" };

type Pendente =
  | { tipo: "call"; card: Card }
  | { tipo: "sinal"; card: Card }
  | { tipo: "venda"; card: Card }
  | { tipo: "followup"; card: Card }
  | { tipo: "sair"; card: Card; saida: "perdido" | "desqualificado" };

function FunilPage() {
  useFunilRealtime();
  const qc = useQueryClient();
  const { papel, memberId, isSocio } = useFunilPapel();
  const { data: cards = [], isLoading } = useFunilCards();
  const { mapa } = useEquipaFotos();
  const [aba, setAba] = useState<"quadro" | "saidas">("quadro");
  const [busca, setBusca] = useState("");
  const [soMeus, setSoMeus] = useState(false);
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [pend, setPend] = useState<Pendente | null>(null);
  const [arrastando, setArrastando] = useState<Card | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["funil_cards"] });

  const ativos = useMemo(() => cards.filter((c) => !c.saida), [cards]);
  const saidas = useMemo(() => cards.filter((c) => c.saida), [cards]);
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ativos.filter((c) => {
      if (soMeus && memberId && c.sdr_id !== memberId && c.closer_id !== memberId) return false;
      if (!q) return true;
      return [c.nome, c.tel, c.email, c.ig].some((v) => v?.toLowerCase().includes(q));
    });
  }, [ativos, busca, soMeus, memberId]);

  async function mover(card: Card, destino: Etapa) {
    if (card.etapa === destino && destino !== "call") return;
    if (!podeIrPara(papel, destino)) {
      toast.error(
        destino === "onboarding" || destino === "aluno" ? "Onboarding e Alunos são do Customer Success."
          : ["realizada", "noshow", "sinal", "venda"].includes(destino) ? "Esta etapa é do closer."
          : "Não tens permissão para mover para esta etapa.");
      return;
    }
    if (destino === "call") return setPend({ tipo: "call", card });
    if (destino === "sinal") return setPend({ tipo: "sinal", card });
    if (destino === "venda") return setPend({ tipo: "venda", card });
    if (destino === "followup") return setPend({ tipo: "followup", card });
    try {
      await rpc("funil_mover", { p_id: card.id, p_etapa: destino });
      refresh();
    } catch (e) { toast.error(msgErro(e)); }
  }

  async function contacto(card: Card, tipo: "ligacao" | "mensagem") {
    try {
      await rpc("funil_registar_contacto", { p_id: card.id, p_tipo: tipo });
      toast.success(tipo === "ligacao" ? "Ligação registada" : "Mensagem registada");
      refresh();
      qc.invalidateQueries({ queryKey: ["funil_metricas"] });
    } catch (e) { toast.error(msgErro(e)); }
  }

  const cardAberto = cards.find((c) => c.id === aberto) ?? null;
  const podeCriar = papel === "socio" || papel === "sdr" || papel === "closer";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="eda-eyebrow">Operação comercial</div>
          <h1 className="text-2xl font-bold">Funil</h1>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text3)" }} />
          <input className="eda-input pl-9 w-56" placeholder="Procurar nome, telefone, @" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
          {([["quadro", "Quadro"], ["saidas", `Fora do funil (${saidas.length})`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)} className="px-3 py-1.5 text-xs font-semibold rounded-md"
              style={aba === k ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text2)" }}>{l}</button>
          ))}
        </div>
        {aba === "quadro" && (
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text2)" }}>
            <input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} /> Só os meus
          </label>
        )}
        {podeCriar && (
          <button className="eda-btn inline-flex items-center gap-2" onClick={() => setNovo(true)}><Plus size={16} /> Novo lead</button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--text2)" }}>A carregar o quadro…</div>
      ) : aba === "quadro" ? (
        <>
          <div className="flex gap-3 overflow-x-auto pb-3 items-start" style={{ minHeight: "60vh" }}>
            {ETAPAS.map((et) => {
              const lista = filtrados.filter((c) => c.etapa === et.key);
              const alvo = sobre === et.key && arrastando && arrastando.etapa !== et.key;
              return (
                <section key={et.key}
                  onDragOver={(e) => { e.preventDefault(); setSobre(et.key); }}
                  onDragLeave={() => setSobre((s) => (s === et.key ? null : s))}
                  onDrop={(e) => { e.preventDefault(); setSobre(null); if (arrastando) mover(arrastando, et.key); setArrastando(null); }}
                  className="w-[268px] shrink-0 rounded-xl flex flex-col"
                  style={{ background: "var(--surface2)", border: `1px solid ${alvo ? et.cor : "var(--border)"}`, boxShadow: alvo ? `0 0 0 2px color-mix(in srgb, ${et.cor} 35%, transparent)` : undefined }}>
                  <header className="px-3 pt-3 pb-2" title={et.dica}>
                    <div className="h-1 rounded-full mb-2" style={{ background: et.cor }} />
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold uppercase tracking-wide">{et.label}</span>
                      <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: "var(--surface)", color: "var(--text2)" }}>{lista.length}</span>
                    </div>
                  </header>
                  <div className="px-2 pb-2 space-y-2 overflow-y-auto" style={{ maxHeight: "68vh", minHeight: 80 }}>
                    {lista.length === 0 && <div className="text-[11px] text-center py-6" style={{ color: "var(--text3)" }}>{alvo ? "Larga aqui" : "Vazio"}</div>}
                    {lista.map((c) => (
                      <CartaoKanban key={c.id} c={c} onOpen={() => setAberto(c.id)}
                        onDragStart={() => setArrastando(c)} onDragEnd={() => { setArrastando(null); setSobre(null); }}
                        onContacto={contacto} sdr={c.sdr_id ? mapa.get(c.sdr_id) : undefined} closer={c.closer_id ? mapa.get(c.closer_id) : undefined}
                        podeContactar={papel === "socio" || papel === "sdr" || papel === "closer"} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {arrastando && podeCriar && !["sinal", "venda", "onboarding", "aluno"].includes(arrastando.etapa) && (
            <div className="sticky bottom-3 z-20 flex gap-3 justify-center">
              {([["desqualificado", "Desqualificado", UserX], ["perdido", "Perdido", Ban]] as const).map(([k, l, I]) => (
                <div key={k}
                  onDragOver={(e) => { e.preventDefault(); setSobre(k); }}
                  onDragLeave={() => setSobre(null)}
                  onDrop={(e) => { e.preventDefault(); setSobre(null); if (arrastando) setPend({ tipo: "sair", card: arrastando, saida: k }); setArrastando(null); }}
                  className="flex items-center gap-2 px-6 py-4 rounded-xl text-sm font-semibold"
                  style={{ background: sobre === k ? "color-mix(in srgb, var(--red) 25%, var(--surface))" : "var(--surface)", border: "2px dashed var(--red)", color: "var(--red)" }}>
                  <I size={18} /> {l}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <ListaSaidas lista={saidas} isSocio={isSocio} podeReativar={podeCriar} mapa={mapa} onChange={refresh} />
      )}

      {novo && <NovoLead onClose={() => setNovo(false)} onDone={() => { setNovo(false); refresh(); }} />}
      {cardAberto && (
        <Detalhe c={cardAberto} papel={papel} mapa={mapa} onClose={() => setAberto(null)} refresh={refresh}
          onMover={(d) => { setAberto(null); mover(cardAberto, d); }}
          onSair={(saida) => { setAberto(null); setPend({ tipo: "sair", card: cardAberto, saida }); }}
          onContacto={contacto} />
      )}
      {pend?.tipo === "call" && <MarcarCall card={pend.card} onClose={() => setPend(null)} onDone={() => { setPend(null); refresh(); qc.invalidateQueries({ queryKey: ["funil_agenda"] }); }} />}
      {pend?.tipo === "sinal" && <RegistarSinal card={pend.card} onClose={() => setPend(null)} onDone={() => { setPend(null); refresh(); qc.invalidateQueries({ queryKey: ["vendas"] }); }} />}
      {pend?.tipo === "venda" && <RegistarVenda card={pend.card} onClose={() => setPend(null)} onDone={() => { setPend(null); refresh(); qc.invalidateQueries({ queryKey: ["vendas"] }); qc.invalidateQueries({ queryKey: ["pag"] }); qc.invalidateQueries({ queryKey: ["finance"] }); }} />}
      {pend?.tipo === "followup" && <MarcarFollowup card={pend.card} onClose={() => setPend(null)} onDone={() => { setPend(null); refresh(); }} />}
      {pend?.tipo === "sair" && <Sair card={pend.card} saida={pend.saida} onClose={() => setPend(null)} onDone={() => { setPend(null); refresh(); }} />}
    </div>
  );
}

/* ------------------------------ Cartão ------------------------------ */
function CartaoKanban({ c, onOpen, onDragStart, onDragEnd, onContacto, sdr, closer, podeContactar }: {
  c: Card; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void;
  onContacto: (c: Card, t: "ligacao" | "mensagem") => void; sdr?: any; closer?: any; podeContactar: boolean;
}) {
  const dias = diasDesde(c.etapa_em);
  const atrasoFollow = c.etapa === "followup" && c.proxima_em && c.proxima_em < hojeISO();
  const parado = ["novo", "conversa", "qualificado", "followup"].includes(c.etapa) && dias >= 3;
  const dono = c.etapa === "onboarding" || c.etapa === "aluno" ? null : (closer ?? sdr);
  return (
    <article draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); onDragStart(); }} onDragEnd={onDragEnd}
      onClick={onOpen} className="rounded-lg p-3 cursor-grab active:cursor-grabbing select-none"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{c.nome}</div>
          <div className="text-[11px] truncate" style={{ color: "var(--text2)" }}>{c.origem}{c.localidade ? ` · ${c.localidade}` : ""}</div>
        </div>
        {c.temperatura && <span className="mt-1 h-2.5 w-2.5 rounded-full shrink-0" title={c.temperatura} style={{ background: TEMP_COR[c.temperatura] }} />}
      </div>
      {c.etapa === "sinal" && c.sinal_valor ? <div className="mt-2 text-xs font-semibold" style={{ color: "var(--green)" }}>Sinal {eur(Number(c.sinal_valor))}</div> : null}
      {c.etapa === "followup" && c.proxima_em && (
        <div className="mt-2 text-[11px] inline-flex items-center gap-1" style={{ color: atrasoFollow ? "var(--red)" : "var(--gold)" }}>
          <CalendarClock size={12} /> {atrasoFollow ? "Atrasado · " : ""}{fmtDiaCurto(c.proxima_em + "T12:00:00")}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text3)" }}>
          <span className="inline-flex items-center gap-1" title="Ligações"><Phone size={11} />{c.ligacoes}</span>
          <span className="inline-flex items-center gap-1" title="Mensagens"><MessageCircle size={11} />{c.mensagens}</span>
          <span className="inline-flex items-center gap-1" title="Dias nesta etapa" style={parado ? { color: "var(--gold)" } : undefined}><Clock size={11} />{dias}d</span>
        </div>
        {dono && <Avatar nome={dono.nome} foto={dono.foto_url} size={20} />}
      </div>
      {podeContactar && ["novo", "conversa", "qualificado", "followup", "noshow"].includes(c.etapa) && (
        <div className="mt-2 grid grid-cols-2 gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button className="rounded-md py-1 text-[11px] font-semibold inline-flex items-center justify-center gap-1" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} onClick={() => onContacto(c, "ligacao")}><Phone size={11} /> Liguei</button>
          <button className="rounded-md py-1 text-[11px] font-semibold inline-flex items-center justify-center gap-1" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} onClick={() => onContacto(c, "mensagem")}><MessageCircle size={11} /> Mensagem</button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------ Novo lead ------------------------------ */
function NovoLead({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ nome: "", tel: "", email: "", ig: "", origem: "Instagram", localidade: "", notas: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nome.trim()) return toast.error("Escreve o nome");
    setBusy(true);
    try {
      await rpc("funil_criar", { p_nome: f.nome, p_tel: f.tel, p_email: f.email, p_ig: f.ig, p_origem: f.origem, p_localidade: f.localidade, p_notas: f.notas });
      toast.success("Lead criado em Novo Lead");
      onDone();
    } catch (err) { toast.error(msgErro(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Novo lead" onClose={onClose}>
      <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-2">
        <Campo l="Nome *"><input className="eda-input" autoFocus value={f.nome} onChange={(e) => set("nome", e.target.value)} /></Campo>
        <Campo l="Origem"><select className="eda-input" value={f.origem} onChange={(e) => set("origem", e.target.value)}>{ORIGENS.map((o) => <option key={o}>{o}</option>)}</select></Campo>
        <Campo l="Telefone / WhatsApp"><input className="eda-input" value={f.tel} onChange={(e) => set("tel", e.target.value)} /></Campo>
        <Campo l="Instagram"><input className="eda-input" placeholder="@" value={f.ig} onChange={(e) => set("ig", e.target.value)} /></Campo>
        <Campo l="Email"><input type="email" className="eda-input" value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
        <Campo l="Cidade / país"><input className="eda-input" value={f.localidade} onChange={(e) => set("localidade", e.target.value)} /></Campo>
        <div className="sm:col-span-2"><Campo l="Notas"><textarea className="eda-input" rows={3} value={f.notas} onChange={(e) => set("notas", e.target.value)} /></Campo></div>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" className="eda-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="eda-btn" disabled={busy}>{busy ? "A guardar…" : "Criar lead"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------ Detalhe ------------------------------ */
function Detalhe({ c, papel, mapa, onClose, refresh, onMover, onSair, onContacto }: {
  c: Card; papel: string; mapa: Map<string, any>; onClose: () => void; refresh: () => void;
  onMover: (d: Etapa) => void; onSair: (s: "perdido" | "desqualificado") => void; onContacto: (c: Card, t: "ligacao" | "mensagem") => void;
}) {
  const [f, setF] = useState({ nome: c.nome, tel: c.tel ?? "", email: c.email ?? "", ig: c.ig ?? "", localidade: c.localidade ?? "", perfil: c.perfil ?? "", notas: c.notas ?? "", temperatura: c.temperatura ?? "", objecao: c.objecao ?? "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const et = ETAPA_POR_KEY[c.etapa];
  const operacao = papel === "socio" || papel === "sdr" || papel === "closer";
  async function guardar() {
    setBusy(true);
    try { await rpc("funil_atualizar", { p_id: c.id, p_dados: f }); toast.success("Guardado"); refresh(); onClose(); }
    catch (e) { toast.error(msgErro(e)); } finally { setBusy(false); }
  }
  const destinos = ETAPAS.filter((e) => e.key !== c.etapa && podeIrPara(papel, e.key));
  return (
    <Modal title={c.nome} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="rounded-full px-2.5 py-1 font-semibold" style={{ background: `color-mix(in srgb, ${et.cor} 18%, transparent)`, color: et.cor, border: `1px solid color-mix(in srgb, ${et.cor} 40%, transparent)` }}>{et.label}</span>
        <span style={{ color: "var(--text2)" }}>{c.origem} · há {diasDesde(c.created_at)}d no funil · {c.ligacoes} ligações · {c.mensagens} mensagens</span>
        {c.sdr_id && <span style={{ color: "var(--text2)" }}>SDR: {mapa.get(c.sdr_id)?.nome ?? "—"}</span>}
        {c.closer_id && <span style={{ color: "var(--text2)" }}>Closer: {mapa.get(c.closer_id)?.nome ?? "—"}</span>}
      </div>
      {operacao && !c.saida && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button className="eda-btn-ghost inline-flex items-center gap-2" onClick={() => onContacto(c, "ligacao")}><Phone size={14} /> Liguei</button>
          <button className="eda-btn-ghost inline-flex items-center gap-2" onClick={() => onContacto(c, "mensagem")}><MessageCircle size={14} /> Mandei mensagem</button>
          {destinos.length > 0 && (
            <select className="eda-input w-auto" value="" onChange={(e) => e.target.value && onMover(e.target.value as Etapa)}>
              <option value="">Mover para…</option>
              {destinos.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo l="Nome"><input className="eda-input" value={f.nome} onChange={(e) => set("nome", e.target.value)} /></Campo>
        <Campo l="Telefone / WhatsApp"><input className="eda-input" value={f.tel} onChange={(e) => set("tel", e.target.value)} /></Campo>
        <Campo l="Email"><input className="eda-input" value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
        <Campo l="Instagram"><input className="eda-input" value={f.ig} onChange={(e) => set("ig", e.target.value)} /></Campo>
        <Campo l="Cidade / país"><input className="eda-input" value={f.localidade} onChange={(e) => set("localidade", e.target.value)} /></Campo>
        <Campo l="Temperatura">
          <select className="eda-input" value={f.temperatura} onChange={(e) => set("temperatura", e.target.value)}>
            <option value="">—</option><option>Quente</option><option>Morno</option><option>Frio</option>
          </select>
        </Campo>
        <Campo l="Perfil / situação"><input className="eda-input" value={f.perfil} onChange={(e) => set("perfil", e.target.value)} /></Campo>
        <Campo l="Principal objeção"><input className="eda-input" value={f.objecao} onChange={(e) => set("objecao", e.target.value)} /></Campo>
        <div className="sm:col-span-2"><Campo l="Notas"><textarea className="eda-input" rows={4} value={f.notas} onChange={(e) => set("notas", e.target.value)} /></Campo></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {operacao && !c.saida && !["sinal", "venda", "onboarding", "aluno"].includes(c.etapa) && (
            <>
              <button className="eda-btn-ghost inline-flex items-center gap-1.5" onClick={() => onSair("desqualificado")}><UserX size={14} /> Desqualificar</button>
              <button className="eda-btn-ghost inline-flex items-center gap-1.5" onClick={() => onSair("perdido")}><Ban size={14} /> Perdido</button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button className="eda-btn-ghost" onClick={onClose}>Fechar</button>
          <button className="eda-btn" disabled={busy} onClick={guardar}>{busy ? "A guardar…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ Modais de etapa ------------------------------ */
function Rodape({ onClose, busy, label }: { onClose: () => void; busy: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" className="eda-btn-ghost" onClick={onClose}>Cancelar</button>
      <button className="eda-btn" disabled={busy}>{busy ? "A guardar…" : label}</button>
    </div>
  );
}
function useSubmit(fn: () => Promise<unknown>, ok: string, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    submit: async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      try { await fn(); toast.success(ok); onDone(); } catch (err) { toast.error(msgErro(err)); } finally { setBusy(false); }
    },
  };
}

function MarcarCall({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const { data: equipa = [] } = useEquipaFotos();
  const closers = equipa.filter((m) => m.role === "closer");
  const { papel, memberId } = useFunilPapel();
  const [closer, setCloser] = useState(card.closer_id ?? (papel === "closer" ? memberId ?? "" : ""));
  const amanha = new Date(Date.now() + 86400000); amanha.setHours(15, 0, 0, 0);
  const [quando, setQuando] = useState(new Date(amanha.getTime() - amanha.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [dur, setDur] = useState(45);
  const [link, setLink] = useState("");
  const { busy, submit } = useSubmit(async () => {
    if (!closer) throw new Error("Escolhe o closer");
    const ini = new Date(quando);
    await rpc("funil_marcar_call", { p_id: card.id, p_closer: closer, p_inicio: ini.toISOString(), p_fim: new Date(ini.getTime() + dur * 60000).toISOString(), p_link: link });
  }, "Call marcada na agenda", onDone);
  return (
    <Modal title={`Marcar call · ${card.nome}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Campo l="Closer"><select className="eda-input" value={closer} onChange={(e) => setCloser(e.target.value)}><option value="">Escolher…</option>{closers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Campo>
        <Campo l="Data e hora"><input type="datetime-local" className="eda-input" value={quando} onChange={(e) => setQuando(e.target.value)} /></Campo>
        <Campo l="Duração"><select className="eda-input" value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} min</option>)}</select></Campo>
        <Campo l="Link da reunião (opcional)"><input className="eda-input" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} /></Campo>
        <div className="sm:col-span-2"><div className="text-xs" style={{ color: "var(--text2)" }}>Se o closer já tiver outra call nesse horário, o sistema avisa e não deixa marcar. Se o lead já tinha uma call, esta fica como remarcação.</div><Rodape onClose={onClose} busy={busy} label="Marcar call" /></div>
      </form>
    </Modal>
  );
}

function MarcarFollowup({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState(new Date(Date.now() + 3 * 86400000).toLocaleDateString("sv-SE"));
  const { busy, submit } = useSubmit(() => rpc("funil_mover", { p_id: card.id, p_etapa: "followup", p_proxima: data }), "Follow-up agendado", onDone);
  return (
    <Modal title={`Follow-up · ${card.nome}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Campo l="Quando voltar a falar?"><input type="date" className="eda-input" value={data} min={hojeISO()} onChange={(e) => setData(e.target.value)} /></Campo>
        <Rodape onClose={onClose} busy={busy} label="Mover para follow-up" />
      </form>
    </Modal>
  );
}

function RegistarSinal({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const [valor, setValor] = useState(""); const [total, setTotal] = useState(""); const [prev, setPrev] = useState("");
  const { busy, submit } = useSubmit(() => rpc("funil_registar_sinal", { p_id: card.id, p_valor: Number(valor), p_total: Number(total), p_prevista: prev || null }), "Sinal registado", onDone);
  return (
    <Modal title={`Sinal pago · ${card.nome}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Campo l="Valor do sinal (€)"><input type="number" step="0.01" className="eda-input" value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
        <Campo l="Valor total previsto (€)"><input type="number" step="0.01" className="eda-input" value={total} onChange={(e) => setTotal(e.target.value)} required /></Campo>
        <Campo l="Previsão de fecho"><input type="date" className="eda-input" value={prev} onChange={(e) => setPrev(e.target.value)} /></Campo>
        <div className="sm:col-span-3"><Rodape onClose={onClose} busy={busy} label="Registar sinal" /></div>
      </form>
    </Modal>
  );
}

const FORMAS = ["À vista", "Cartão - à vista", "Klarna", "MB Way", "Dinheiro", "Pagamento Recorrente"];
function RegistarVenda({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const temSinal = !!card.venda_id && card.etapa === "sinal";
  const [ticket, setTicket] = useState(""); const [forma, setForma] = useState("À vista"); const [parc, setParc] = useState("2");
  const [pago, setPago] = useState(""); const [produto, setProduto] = useState("Europa Digital Academy");
  const rec = forma === "Pagamento Recorrente";
  const { busy, submit } = useSubmit(() => rpc("funil_registar_venda", {
    p_id: card.id, p_ticket: temSinal ? null : Number(ticket), p_forma: forma, p_parcelas: rec ? Number(parc) : 1,
    p_pago: pago === "" ? null : Number(pago), p_produto: produto,
  }), "Venda registada", onDone);
  return (
    <Modal title={`Venda paga · ${card.nome}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {temSinal
          ? <div className="sm:col-span-2 text-sm" style={{ color: "var(--text2)" }}>O sinal de {eur(Number(card.sinal_valor ?? 0))} vira venda pelo valor total previsto. Comissões e cobranças são calculadas automaticamente.</div>
          : <Campo l="Valor da venda (€)"><input type="number" step="0.01" className="eda-input" value={ticket} onChange={(e) => setTicket(e.target.value)} required /></Campo>}
        <Campo l="Forma de pagamento"><select className="eda-input" value={forma} onChange={(e) => setForma(e.target.value)}>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select></Campo>
        {rec && <Campo l="Nº de parcelas"><input type="number" min={2} className="eda-input" value={parc} onChange={(e) => setParc(e.target.value)} /></Campo>}
        <Campo l={rec || temSinal ? "Já pago (€)" : "Já pago (€) · vazio = total"}><input type="number" step="0.01" className="eda-input" value={pago} onChange={(e) => setPago(e.target.value)} /></Campo>
        {!temSinal && <Campo l="Produto"><select className="eda-input" value={produto} onChange={(e) => setProduto(e.target.value)}><option>Europa Digital Academy</option><option>PVE</option></select></Campo>}
        <div className="sm:col-span-2"><Rodape onClose={onClose} busy={busy} label="Registar venda" /></div>
      </form>
    </Modal>
  );
}

function Sair({ card, saida, onClose, onDone }: { card: Card; saida: "perdido" | "desqualificado"; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState("");
  const { busy, submit } = useSubmit(() => rpc("funil_sair", { p_id: card.id, p_tipo: saida, p_motivo: motivo }), saida === "perdido" ? "Marcado como perdido" : "Enviado para desqualificados", onDone);
  const opcoes = saida === "desqualificado"
    ? ["Sem perfil / sem condições", "Não é da Europa", "Sem interesse real", "Contacto inválido", "Curioso / concorrente"]
    : ["Achou caro", "Sem tempo agora", "Foi para outro", "Parou de responder", "Vai pensar e sumiu"];
  return (
    <Modal title={`${saida === "perdido" ? "Perdido" : "Desqualificado"} · ${card.nome}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-2">{opcoes.map((o) => <button type="button" key={o} onClick={() => setMotivo(o)} className="rounded-full px-3 py-1 text-xs" style={{ border: "1px solid var(--border)", background: motivo === o ? "var(--accent)" : "var(--surface2)", color: motivo === o ? "#fff" : "var(--text)" }}>{o}</button>)}</div>
        <Campo l="Motivo"><input className="eda-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escreve ou escolhe acima" /></Campo>
        <div className="text-xs" style={{ color: "var(--text2)" }}>Fica na lista “Fora do funil”, onde o Pablo e o Leandro revisam. Dá para reativar.</div>
        <Rodape onClose={onClose} busy={busy} label="Confirmar" />
      </form>
    </Modal>
  );
}

/* ------------------------------ Fora do funil ------------------------------ */
function ListaSaidas({ lista, isSocio, podeReativar, mapa, onChange }: { lista: Card[]; isSocio: boolean; podeReativar: boolean; mapa: Map<string, any>; onChange: () => void }) {
  const [filtro, setFiltro] = useState<"todos" | "desqualificado" | "perdido">("todos");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const vis = lista.filter((c) => filtro === "todos" || c.saida === filtro).sort((a, b) => String(b.saida_em).localeCompare(String(a.saida_em)));
  async function reativar(id: string) { try { await rpc("funil_reativar", { p_id: id }); toast.success("Voltou para o quadro"); onChange(); } catch (e) { toast.error(msgErro(e)); } }
  async function apagar() {
    if (!sel.size) return;
    const { error } = await (supabase.from as any)("funil_cards").delete().in("id", [...sel]);
    if (error) return toast.error(msgErro(error));
    toast.success(`${sel.size} apagado(s)`); setSel(new Set()); onChange();
  }
  const [confirmar, setConfirmar] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["todos", "desqualificado", "perdido"] as const).map((k) => (
          <button key={k} onClick={() => setFiltro(k)} className="rounded-full px-3 py-1 text-xs font-semibold capitalize" style={{ border: "1px solid var(--border)", background: filtro === k ? "var(--accent)" : "var(--surface2)", color: filtro === k ? "#fff" : "var(--text2)" }}>{k === "todos" ? "Todos" : k + "s"}</button>
        ))}
        {isSocio && sel.size > 0 && (confirmar
          ? <span className="ml-auto flex items-center gap-2 text-xs">Apagar {sel.size} para sempre? <button className="eda-btn" onClick={() => { setConfirmar(false); apagar(); }}>Sim, apagar</button><button className="eda-btn-ghost" onClick={() => setConfirmar(false)}>Não</button></span>
          : <button className="ml-auto eda-btn-ghost inline-flex items-center gap-1.5" onClick={() => setConfirmar(true)}><Trash2 size={14} /> Apagar selecionados ({sel.size})</button>)}
      </div>
      <div className="eda-card p-0 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 720 }}>
          <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--text2)", background: "var(--surface2)" }}>
            {isSocio && <th className="px-3 py-3 w-8" />}
            {["Lead", "Saída", "Motivo", "SDR", "Quando", ""].map((h) => <th key={h} className="px-4 py-3 font-semibold tracking-[.08em]">{h}</th>)}
          </tr></thead>
          <tbody>
            {vis.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: "var(--text3)" }}>Nada por aqui.</td></tr>}
            {vis.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                {isSocio && <td className="px-3"><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>}
                <td className="px-4 py-2.5"><div className="font-semibold">{c.nome}</div><div className="text-xs" style={{ color: "var(--text2)" }}>{c.origem}{c.tel ? ` · ${c.tel}` : ""}</div></td>
                <td className="px-4"><span className="text-xs font-semibold capitalize" style={{ color: c.saida === "perdido" ? "var(--gold)" : "var(--red)" }}>{c.saida}</span></td>
                <td className="px-4">{c.saida_motivo ?? "—"}</td>
                <td className="px-4">{c.sdr_id ? mapa.get(c.sdr_id)?.nome ?? "—" : "—"}</td>
                <td className="px-4 whitespace-nowrap">{c.saida_em ? fmtDiaCurto(c.saida_em) : "—"}</td>
                <td className="px-4 text-right">{podeReativar && <button className="eda-btn-ghost inline-flex items-center gap-1.5" onClick={() => reativar(c.id)}><RotateCcw size={13} /> Reativar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
