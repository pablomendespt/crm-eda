import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Video, Phone } from "lucide-react";
import { Modal } from "@/lib/pagamentos-ui";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { Avatar } from "@/components/Avatar";
import { rpc, msgErro, useFunilAgenda, useFunilCards, useFunilPapel, useFunilRealtime, fmtHora, type Agenda } from "@/lib/funil";

export const Route = createFileRoute("/_authenticated/agenda")({ component: AgendaPage });

const HORA_INI = 8, HORA_FIM = 22, PX_HORA = 56;
const CORES = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#eab308"];
const ESTADO_TXT: Record<string, string> = { marcada: "Marcada", realizada: "Realizada", noshow: "No-show", cancelada: "Cancelada", remarcada: "Remarcada" };

function inicioSemana(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // segunda = 0
  x.setDate(x.getDate() - dow);
  return x;
}
const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function AgendaPage() {
  useFunilRealtime();
  const qc = useQueryClient();
  const { papel, memberId } = useFunilPapel();
  const { data: equipa = [], mapa } = useEquipaFotos() as any;
  const { data: cards = [] } = useFunilCards();
  const [semana, setSemana] = useState(() => inicioSemana(new Date()));
  const [soMinhas, setSoMinhas] = useState(papel === "closer");
  const [aberta, setAberta] = useState<Agenda | null>(null);

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(semana); d.setDate(d.getDate() + i); return d; }), [semana]);
  const fimSemana = new Date(semana); fimSemana.setDate(fimSemana.getDate() + 7);
  const { data: eventos = [] } = useFunilAgenda(semana.toISOString(), fimSemana.toISOString());
  const closers = (equipa as any[]).filter((m) => m.role === "closer");
  const cor = (id: string) => CORES[Math.max(0, closers.findIndex((c) => c.id === id)) % CORES.length];
  const cardPor = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const visiveis = eventos.filter((e) => e.estado !== "cancelada" && e.estado !== "remarcada" && (!soMinhas || !memberId || e.closer_id === memberId));
  const agora = new Date();

  async function estado(e: Agenda, destino: "realizada" | "noshow") {
    try { await rpc("funil_mover", { p_id: e.card_id, p_etapa: destino }); toast.success(destino === "realizada" ? "Call marcada como realizada" : "Marcada como no-show"); setAberta(null); qc.invalidateQueries({ queryKey: ["funil_agenda"] }); qc.invalidateQueries({ queryKey: ["funil_cards"] }); }
    catch (err) { toast.error(msgErro(err)); }
  }

  const titulo = `${semana.toLocaleDateString("pt-PT", { day: "numeric", month: "short" })} – ${new Date(fimSemana.getTime() - 86400000).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><div className="eda-eyebrow">Calls</div><h1 className="text-2xl font-bold">Agenda</h1></div>
        {papel !== "sdr" && memberId && papel !== "socio" && (
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text2)" }}><input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} /> Só as minhas</label>
        )}
        <div className="flex items-center gap-1">
          <button className="eda-btn-ghost" aria-label="Semana anterior" onClick={() => setSemana((s) => { const d = new Date(s); d.setDate(d.getDate() - 7); return d; })}><ChevronLeft size={16} /></button>
          <button className="eda-btn-ghost" onClick={() => setSemana(inicioSemana(new Date()))}>Hoje</button>
          <button className="eda-btn-ghost" aria-label="Próxima semana" onClick={() => setSemana((s) => { const d = new Date(s); d.setDate(d.getDate() + 7); return d; })}><ChevronRight size={16} /></button>
        </div>
        <div className="text-sm font-semibold capitalize min-w-[190px] text-right">{titulo}</div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text2)" }}>
        {closers.map((c) => <span key={c.id} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: cor(c.id) }} />{c.nome}</span>)}
        <span className="ml-auto">{visiveis.length} call(s) nesta semana</span>
      </div>

      {/* Desktop: grelha semanal */}
      <div className="eda-card p-0 overflow-x-auto hidden md:block">
        <div style={{ minWidth: 820 }}>
          <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
            <div />
            {dias.map((d) => (
              <div key={d.toISOString()} className="px-2 py-2 text-center border-l" style={{ borderColor: "var(--border)", background: mesmoDia(d, agora) ? "color-mix(in srgb, var(--accent) 10%, transparent)" : undefined }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text2)" }}>{d.toLocaleDateString("pt-PT", { weekday: "short" })}</div>
                <div className="text-lg font-bold" style={mesmoDia(d, agora) ? { color: "var(--accent)" } : undefined}>{d.getDate()}</div>
              </div>
            ))}
          </div>
          <div className="grid border-t" style={{ gridTemplateColumns: "56px repeat(7, 1fr)", borderColor: "var(--border)" }}>
            <div>{Array.from({ length: HORA_FIM - HORA_INI }, (_, i) => <div key={i} className="text-[10px] text-right pr-2 -mt-1.5" style={{ height: PX_HORA, color: "var(--text3)" }}>{String(HORA_INI + i).padStart(2, "0")}:00</div>)}</div>
            {dias.map((d) => {
              const doDia = visiveis.filter((e) => mesmoDia(new Date(e.inicio), d));
              return (
                <div key={d.toISOString()} className="relative border-l" style={{ borderColor: "var(--border)", height: PX_HORA * (HORA_FIM - HORA_INI) }}>
                  {Array.from({ length: HORA_FIM - HORA_INI }, (_, i) => <div key={i} className="border-t" style={{ height: PX_HORA, borderColor: "var(--border)" }} />)}
                  {mesmoDia(d, agora) && agora.getHours() >= HORA_INI && agora.getHours() < HORA_FIM && (
                    <div className="absolute left-0 right-0 h-0.5 z-10" style={{ top: ((agora.getHours() - HORA_INI) + agora.getMinutes() / 60) * PX_HORA, background: "var(--red)" }} />
                  )}
                  {doDia.map((e) => {
                    const ini = new Date(e.inicio), fim = new Date(e.fim);
                    const top = Math.max(0, ((ini.getHours() - HORA_INI) + ini.getMinutes() / 60) * PX_HORA);
                    const h = Math.max(26, ((fim.getTime() - ini.getTime()) / 3600000) * PX_HORA - 2);
                    const c = cardPor.get(e.card_id);
                    const cl = cor(e.closer_id);
                    return (
                      <button key={e.id} onClick={() => setAberta(e)} className="absolute left-1 right-1 rounded-md px-2 py-1 text-left overflow-hidden"
                        style={{ top, height: h, background: `color-mix(in srgb, ${cl} 22%, var(--surface))`, borderLeft: `3px solid ${cl}`, opacity: e.estado === "noshow" ? .55 : 1 }}>
                        <div className="text-[11px] font-semibold truncate">{c?.nome ?? "Lead"}</div>
                        <div className="text-[10px] truncate" style={{ color: "var(--text2)" }}>{fmtHora(e.inicio)} · {ESTADO_TXT[e.estado]}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Telemóvel: lista por dia */}
      <div className="md:hidden space-y-3">
        {dias.map((d) => {
          const doDia = visiveis.filter((e) => mesmoDia(new Date(e.inicio), d));
          return (
            <div key={d.toISOString()} className="eda-card">
              <div className="text-sm font-bold capitalize mb-2" style={mesmoDia(d, agora) ? { color: "var(--accent)" } : undefined}>{d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "short" })}</div>
              {doDia.length === 0 ? <div className="text-xs" style={{ color: "var(--text3)" }}>Sem calls</div> : doDia.map((e) => (
                <button key={e.id} onClick={() => setAberta(e)} className="w-full flex items-center gap-3 py-2 text-left border-t first:border-t-0" style={{ borderColor: "var(--border)" }}>
                  <i className="h-8 w-1 rounded-full" style={{ background: cor(e.closer_id) }} />
                  <div className="min-w-0"><div className="text-sm font-semibold truncate">{cardPor.get(e.card_id)?.nome ?? "Lead"}</div><div className="text-xs" style={{ color: "var(--text2)" }}>{fmtHora(e.inicio)} – {fmtHora(e.fim)} · {mapa.get(e.closer_id)?.nome ?? ""} · {ESTADO_TXT[e.estado]}</div></div>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {aberta && (() => {
        const c = cardPor.get(aberta.card_id);
        const closer = mapa.get(aberta.closer_id);
        return (
          <Modal title={c?.nome ?? "Call"} onClose={() => setAberta(null)}>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">{closer && <Avatar nome={closer.nome} foto={closer.foto_url} size={36} />}<div><div className="font-semibold">{closer?.nome ?? "Closer"}</div><div style={{ color: "var(--text2)" }}>{new Date(aberta.inicio).toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })} · {fmtHora(aberta.inicio)} – {fmtHora(aberta.fim)}</div></div></div>
              <div style={{ color: "var(--text2)" }}>Estado: <strong style={{ color: "var(--text)" }}>{ESTADO_TXT[aberta.estado]}</strong>{c?.tel ? <> · <Phone size={12} className="inline" /> {c.tel}</> : null}</div>
              {aberta.link && <a href={aberta.link} target="_blank" rel="noreferrer" className="eda-btn-ghost inline-flex items-center gap-2"><Video size={14} /> Entrar na reunião</a>}
              {c?.notas && <div className="rounded-lg p-3 text-xs" style={{ background: "var(--surface2)" }}>{c.notas}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                {aberta.estado === "marcada" && (papel === "closer" || papel === "socio") && (
                  <>
                    <button className="eda-btn" onClick={() => estado(aberta, "realizada")}>Call realizada</button>
                    <button className="eda-btn-ghost" onClick={() => estado(aberta, "noshow")}>No-show</button>
                  </>
                )}
                <Link to="/funil" className="eda-btn-ghost">Abrir no funil</Link>
              </div>
              {aberta.estado === "marcada" && <div className="text-xs" style={{ color: "var(--text3)" }}>Para remarcar, arrasta o cartão para “Call marcada” no funil e escolhe a nova hora.</div>}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
