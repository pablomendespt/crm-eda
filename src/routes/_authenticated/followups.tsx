import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { eur } from "@/lib/format";
import {
  LEAD_ESTADOS,
  LEAD_ESTADO_FECHADOS,
  FOLLOWUP_LEAD_COLS,
  leadEstadoInfo,
  type FollowUpLead,
} from "@/lib/followups";
import { LeadFollowUpForm } from "@/components/LeadFollowUpForm";
import { LeadDetailsDrawer } from "@/components/LeadDetailsDrawer";
import { Plus, Search, Eye, Pencil, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/followups")({
  component: FollowUpsPage,
});

type Member = { id: string; nome: string; role: string; ativo: boolean };
type Lead = FollowUpLead;
type SortKey = "previsao" | "ticket" | "fus" | "lig" | "call";

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekStart(d = new Date()) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function fmtD(s: string | null) { if (!s) return "—"; const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y.slice(2)}`; }
function callDate(l: Lead) { return l.call_1_at ? iso(new Date(l.call_1_at)) : l.data_1call; }
function bucket(n: number, f: string) { if (!f) return true; if (f === "3") return n >= 3; return n === Number(f); }

function FollowUpsPage() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const isSocio = profile?.role === "socio";

  const [q, setQ] = useState("");
  const [periodo, setPeriodo] = useState<"all" | "week" | "month" | "custom">("all");
  const [pFrom, setPFrom] = useState(iso(new Date()));
  const [pTo, setPTo] = useState(iso(new Date()));
  const [fEstado, setFEstado] = useState<string>("ativos");
  const [fFus, setFFus] = useState("");
  const [fLig, setFLig] = useState("");
  const [fSinal, setFSinal] = useState<"" | "sim" | "nao">("");
  const [fPrev, setFPrev] = useState<"" | "hoje" | "semana" | "mes" | "custom">("");
  const [prevFrom, setPrevFrom] = useState(iso(new Date()));
  const [prevTo, setPrevTo] = useState(iso(new Date()));
  const [fSdr, setFSdr] = useState("");
  const [fCloser, setFCloser] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 } | null>(null);
  const [formLead, setFormLead] = useState<Lead | null | "new">(null);
  const [viewId, setViewId] = useState<string | null>(null);

  const { data: leads = [] } = useQuery({
    queryKey: ["leads-followups"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("leads").select(FOLLOWUP_LEAD_COLS);
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return (data ?? []) as Member[];
    },
  });
  const memberNames = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.nome])) as Record<string, string>, [members]);
  const sdrs = useMemo(() => members.filter((m) => m.ativo && m.role === "sdr"), [members]);
  const closers = useMemo(() => members.filter((m) => m.ativo && m.role === "closer"), [members]);

  useEffect(() => {
    const ch = supabase
      .channel("rt-followups-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => qc.invalidateQueries({ queryKey: ["leads-followups"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtered = useMemo(() => {
    const today = new Date();
    const tISO = iso(today);
    let arr = leads.slice();

    const s = q.trim().toLowerCase();
    if (s) {
      const digits = s.replace(/\D/g, "");
      arr = arr.filter((l) =>
        l.nome.toLowerCase().includes(s) ||
        (digits.length > 0 && (l.tel ?? "").replace(/\D/g, "").includes(digits)) ||
        (l.sdr_id ? (memberNames[l.sdr_id] ?? "").toLowerCase().includes(s) : false),
      );
    }
    if (periodo !== "all") {
      const from = periodo === "week" ? iso(weekStart()) : periodo === "month" ? iso(new Date(today.getFullYear(), today.getMonth(), 1)) : pFrom;
      const to = periodo === "custom" ? pTo : tISO;
      arr = arr.filter((l) => { const d = l.created_at.slice(0, 10); return d >= from && d <= to; });
    }
    if (fEstado === "ativos") arr = arr.filter((l) => !LEAD_ESTADO_FECHADOS.includes(l.fu_estado));
    else if (fEstado) arr = arr.filter((l) => l.fu_estado === fEstado);
    arr = arr.filter((l) => bucket(l.qtd_followups, fFus) && bucket(l.qtd_ligacoes, fLig));
    if (fSinal) arr = arr.filter((l) => (fSinal === "sim") === !!l.deu_sinal);
    if (fPrev) {
      let from = tISO, to = tISO;
      if (fPrev === "semana") { const ws = weekStart(); from = iso(ws); const we = new Date(ws); we.setDate(we.getDate() + 6); to = iso(we); }
      if (fPrev === "mes") { from = iso(new Date(today.getFullYear(), today.getMonth(), 1)); to = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)); }
      if (fPrev === "custom") { from = prevFrom; to = prevTo; }
      arr = arr.filter((l) => l.data_prevista_fecho && l.data_prevista_fecho >= from && l.data_prevista_fecho <= to);
    }
    if (fSdr) arr = arr.filter((l) => l.sdr_id === fSdr);
    if (isSocio && fCloser) arr = arr.filter((l) => l.closer_id === fCloser);

    if (sort) {
      const val = (l: Lead): number | string => {
        switch (sort.k) {
          case "previsao": return l.data_prevista_fecho ?? "9999";
          case "ticket": return Number(l.ticket ?? 0);
          case "fus": return l.qtd_followups;
          case "lig": return l.qtd_ligacoes;
          case "call": return callDate(l) ?? "0000";
        }
      };
      arr.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
    } else {
      // Padrão: previsão de fecho mais próxima primeiro (sem previsão no fim).
      arr.sort((a, b) => (a.data_prevista_fecho ?? "9999").localeCompare(b.data_prevista_fecho ?? "9999"));
    }
    return arr;
  }, [leads, memberNames, q, periodo, pFrom, pTo, fEstado, fFus, fLig, fSinal, fPrev, prevFrom, prevTo, fSdr, fCloser, isSocio, sort]);

  function toggleSort(k: SortKey) {
    setSort((s) => (!s || s.k !== k ? { k, dir: 1 } : s.dir === 1 ? { k, dir: -1 } : null));
  }
  const SortTh = ({ k, children, w }: { k: SortKey; children: React.ReactNode; w: number }) => (
    <th className="px-4 py-3 cursor-pointer select-none whitespace-nowrap" style={{ minWidth: w }} onClick={() => toggleSort(k)}>
      {children}{sort?.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  const Th = ({ children, w }: { children: React.ReactNode; w: number }) => (
    <th className="px-4 py-3 whitespace-nowrap" style={{ minWidth: w }}>{children}</th>
  );

  const viewLead = viewId ? leads.find((l) => l.id === viewId) ?? null : null;
  const todayISO = iso(new Date());

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Follow-ups</h1>
          <p className="text-sm max-w-xl" style={{ color: "var(--text2)" }}>
            Uma linha por lead. Acompanhe suas oportunidades, follow-ups e próximos fechamentos.
          </p>
        </div>
        <button onClick={() => setFormLead("new")} className="eda-btn flex items-center gap-2">
          <Plus size={14} /> Novo follow-up
        </button>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text3)" }} />
          <input className="eda-input w-full" style={{ paddingLeft: 42, height: 46, fontSize: 15 }}
            placeholder="Pesquisar por lead, número ou SDR..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
          <Filt label="Período">
            <select className="eda-input w-full" value={periodo} onChange={(e) => setPeriodo(e.target.value as any)}>
              <option value="all">Todo período</option><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Personalizado</option>
            </select>
          </Filt>
          <Filt label="Estado">
            <select className="eda-input w-full" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
              <option value="ativos">Ativos</option><option value="">Todos</option>
              {LEAD_ESTADOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Filt>
          <Filt label="Follow-ups">
            <select className="eda-input w-full" value={fFus} onChange={(e) => setFFus(e.target.value)}>
              <option value="">Todos</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3+</option>
            </select>
          </Filt>
          <Filt label="Ligações">
            <select className="eda-input w-full" value={fLig} onChange={(e) => setFLig(e.target.value)}>
              <option value="">Todas</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3+</option>
            </select>
          </Filt>
          <Filt label="Deu sinal?">
            <select className="eda-input w-full" value={fSinal} onChange={(e) => setFSinal(e.target.value as any)}>
              <option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option>
            </select>
          </Filt>
          <Filt label="Previsão de fecho">
            <select className="eda-input w-full" value={fPrev} onChange={(e) => setFPrev(e.target.value as any)}>
              <option value="">Qualquer</option><option value="hoje">Hoje</option><option value="semana">Esta semana</option><option value="mes">Este mês</option><option value="custom">Personalizado</option>
            </select>
          </Filt>
          <Filt label="Agendado por">
            <select className="eda-input w-full" value={fSdr} onChange={(e) => setFSdr(e.target.value)}>
              <option value="">Todos</option>
              {sdrs.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Filt>
          {isSocio && (
            <Filt label="Closer">
              <select className="eda-input w-full" value={fCloser} onChange={(e) => setFCloser(e.target.value)}>
                <option value="">Todos</option>
                {closers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </Filt>
          )}
        </div>
        {(periodo === "custom" || fPrev === "custom") && (
          <div className="flex flex-wrap gap-4">
            {periodo === "custom" && (<>
              <Filt label="Entrada de"><input type="date" className="eda-input" value={pFrom} onChange={(e) => setPFrom(e.target.value)} /></Filt>
              <Filt label="até"><input type="date" className="eda-input" value={pTo} onChange={(e) => setPTo(e.target.value)} /></Filt>
            </>)}
            {fPrev === "custom" && (<>
              <Filt label="Previsão de"><input type="date" className="eda-input" value={prevFrom} onChange={(e) => setPrevFrom(e.target.value)} /></Filt>
              <Filt label="até"><input type="date" className="eda-input" value={prevTo} onChange={(e) => setPrevTo(e.target.value)} /></Filt>
            </>)}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="text-xs" style={{ color: "var(--text3)" }}>{filtered.length} lead(s)</div>

        {/* Desktop: tabela de leitura */}
        <div className="eda-card hidden md:block overflow-x-auto" style={{ padding: 0 }}>
          <table className="w-full text-sm" style={{ minWidth: 1500 }}>
            <thead style={{ background: "var(--surface2)" }}>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>
                <Th w={220}>Lead</Th>
                <SortTh k="call" w={110}>1ª Call</SortTh>
                <SortTh k="previsao" w={120}>Previsão</SortTh>
                <Th w={150}>Número</Th>
                <Th w={130}>SDR</Th>
                <SortTh k="ticket" w={110}>Ticket</SortTh>
                <Th w={230}>Estado</Th>
                <SortTh k="fus" w={110}>Follow-ups</SortTh>
                <SortTh k="lig" w={100}>Ligações</SortTh>
                <Th w={130}>Sinal</Th>
                <Th w={100}>Call</Th>
                <Th w={90}>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const est = leadEstadoInfo(l.fu_estado);
                const prevAtrasada = l.data_prevista_fecho && l.data_prevista_fecho <= todayISO && !LEAD_ESTADO_FECHADOS.includes(l.fu_estado);
                return (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="px-4 py-3.5">
                      <button type="button" onClick={() => setViewId(l.id)} className="font-semibold text-left hover:underline">{l.nome}</button>
                      {isSocio && l.closer_id && <div className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>{memberNames[l.closer_id]}</div>}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{fmtD(callDate(l))}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap" style={{ color: prevAtrasada ? "var(--gold)" : undefined }}>{fmtD(l.data_prevista_fecho)}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{l.tel || "—"}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{l.sdr_id ? memberNames[l.sdr_id] ?? "—" : "—"}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{l.ticket ? eur(l.ticket) : "—"}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-md whitespace-nowrap" style={{ background: "var(--surface3)", color: est.color }}>{est.label}</span>
                    </td>
                    <td className="px-4 py-3.5 font-semibold">{l.qtd_followups}</td>
                    <td className="px-4 py-3.5 font-semibold">{l.qtd_ligacoes}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {l.deu_sinal ? <span style={{ color: "var(--green)" }}>Sim · {eur(l.sinal)}</span> : <span style={{ color: "var(--text3)" }}>Não</span>}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {l.link_call ? (
                        <a href={l.link_call} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--accent)" }}>
                          Ver call <ExternalLink size={12} />
                        </a>
                      ) : <span style={{ color: "var(--text3)" }}>—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <RowActions onView={() => setViewId(l.id)} onEdit={() => setFormLead(l)} />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="text-center py-12 text-sm" style={{ color: "var(--text3)" }}>Sem leads com estes filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Telemóvel: cartões resumidos */}
        <div className="md:hidden space-y-3">
          {filtered.map((l) => {
            const est = leadEstadoInfo(l.fu_estado);
            return (
              <div key={l.id} className="eda-card" style={{ padding: 14 }}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="text-left min-w-0" onClick={() => setViewId(l.id)}>
                    <div className="font-semibold truncate">{l.nome}</div>
                    <span className="inline-block mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: "var(--surface3)", color: est.color }}>{est.label}</span>
                  </button>
                  <RowActions onView={() => setViewId(l.id)} onEdit={() => setFormLead(l)} />
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
                  <Mini k="Previsão" v={fmtD(l.data_prevista_fecho)} />
                  <Mini k="Follow-ups" v={l.qtd_followups} />
                  <Mini k="Ligações" v={l.qtd_ligacoes} />
                  <Mini k="Sinal" v={l.deu_sinal ? eur(l.sinal) : "Não"} />
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-sm text-center py-8" style={{ color: "var(--text3)" }}>Sem leads com estes filtros.</div>}
        </div>
      </div>

      {viewLead && (
        <LeadDetailsDrawer lead={viewLead} memberNames={memberNames} onClose={() => setViewId(null)}
          onEdit={() => { setFormLead(viewLead); setViewId(null); }} />
      )}
      {formLead && (
        <LeadFollowUpForm lead={formLead === "new" ? null : formLead} members={members} onClose={() => setFormLead(null)} />
      )}
    </div>
  );
}

function RowActions({ onView, onEdit }: { onView: () => void; onEdit: () => void }) {
  const cls = "w-9 h-9 flex items-center justify-center rounded-md transition-colors";
  return (
    <div className="flex items-center gap-1">
      <button type="button" title="Ver lead" aria-label="Ver lead" onClick={onView} className={cls} style={{ color: "var(--text2)", background: "var(--surface3)" }}><Eye size={15} /></button>
      <button type="button" title="Editar lead" aria-label="Editar lead" onClick={onEdit} className={cls} style={{ color: "var(--accent)", background: "var(--surface3)" }}><Pencil size={14} /></button>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase" style={{ color: "var(--text3)" }}>{k}</div>
      <div className="font-medium mt-0.5">{v}</div>
    </div>
  );
}

function Filt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text3)" }}>{label}</label>
      {children}
    </div>
  );
}
