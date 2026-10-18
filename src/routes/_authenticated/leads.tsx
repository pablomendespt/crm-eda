import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { X, Search, Plus, Video, AlertTriangle, Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallForm } from "@/components/CallForm";
import { financeRpc } from "@/lib/finance-reporting";
import { NumInput } from "@/components/NumInput";
import { useProfile } from "@/hooks/useAuth";
import { useMembrosDir } from "@/lib/membros";
import { friendlyError } from "@/lib/rls-error";
import {
  CALL_STATUS, callStatusInfo, QUALIFICACAO, MOTIVOS_DESQ, FONTES, PRODUTOS, METODOS, FILTROS_RAPIDOS, HIST_LABEL,
} from "@/lib/central-leads";

type Periodo = "todos" | "hoje" | "semana" | "mes" | "custom";
const PERIODO_LABEL: Record<Periodo, string> = { todos: "Todo período", hoje: "Hoje", semana: "Esta semana", mes: "Este mês", custom: "Personalizado" };
const F0 = {
  status: "", fonte: "", sdr: "", closer: "", qual: "", produto: "", metodo: "", vmin: "", vmax: "",
  callDe: "", callAte: "", fechoDe: "", fechoAte: "", fuDe: "", fuAte: "",
};
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const Route = createFileRoute("/_authenticated/leads")({
  component: CentralLeads,
});

type Lead = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  call_status: string | null;
  call_at: string | null;
  qualificacao: string;
  fonte: string | null;
  sdr_member_id: string | null;
  responsavel_member_id: string | null;
  produto: string | null;
  preco: number | null;
  valor_sinal: number;
  metodo_pagamento: string | null;
  data_prevista_fechamento: string | null;
  proximo_followup: string | null;
  link_call: string | null;
  briefing: string | null;
  observacoes: string | null;
  motivo_desqualificacao: string | null;
  noshow_count: number;
  noshow_motivo: string | null;
  created_at: string;
  updated_at: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-PT")} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const legacyStatus = (s: string) => (s === "fechado" ? "fechado" : s === "nao_compareceu" ? "no_show" : "follow_up");

function StatusTag({ s }: { s: string | null }) {
  const i = callStatusInfo(s);
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: i.color, background: `color-mix(in srgb, ${i.color} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${i.color} 35%, transparent)` }}
    >
      {i.label}
    </span>
  );
}

function CentralLeads() {
  const { data: profile } = useProfile();
  const role = profile?.role;
  const qc=useQueryClient();
  const management=profile?.isGerencia===true;
  const [callLead,setCallLead]=useState<Lead | "new" | null>(null);
  async function removeLead(l:Lead){
    if(!management || !window.confirm(`Apagar o lead ${l.nome}? Esta ação não pode ser desfeita.`))return;
    try{await financeRpc("central_apagar_lead",{p_lead:l.id});await qc.invalidateQueries({queryKey:["leads_consolidados"]});setAbrir(null);toast.success("Lead apagado.");}catch(e){toast.error(friendlyError(e));}
  }
  const canViewAll = profile?.canViewAll === true;
  const myMemberId = (profile?.profile as any)?.member_id as string | undefined;
  const { closers, sdrs, todos } = useMembrosDir();
  const nomeDe = useMemo(() => Object.fromEntries(todos.map((m) => [m.id, m.nome])), [todos]);

  const [rapido, setRapido] = useState("todos");
  const [q, setQ] = useState("");
  const [f, setF] = useState(F0);
  const [periodo, setPeriodo] = useState<Periodo>("todos");
  const [pDe, pAte] = useMemo(() => {
    const t = new Date();
    if (periodo === "hoje") return [isoLocal(t), isoLocal(t)];
    if (periodo === "semana") {
      const s = new Date(t); const dw = s.getDay(); s.setDate(s.getDate() + (dw === 0 ? -6 : 1 - dw));
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return [isoLocal(s), isoLocal(e)];
    }
    if (periodo === "mes") return [isoLocal(new Date(t.getFullYear(), t.getMonth(), 1)), isoLocal(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
    if (periodo === "custom") return [f.callDe, f.callAte];
    return ["", ""];
  }, [periodo, f.callDe, f.callAte]);
  const [ordem, setOrdem] = useState<"data" | "atualizado" | "valor_desc" | "valor_asc" | "previsao">("data");
  const [verAvancados, setVerAvancados] = useState(false);
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<Lead | null>(null);
  const [abrir, setAbrir] = useState<Lead | null>(null);

  const { data: leads = [] } = useQuery({
    queryKey: ["leads_consolidados", "central"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads_consolidados").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });

  const now = Date.now();
  const pendente = (l: Lead) => l.call_status === "call_marcada" && !!l.call_at && new Date(l.call_at).getTime() < now;

  const base = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, "");
    const inR = (v: string | null, de: string, ate: string) => {
      if (!de && !ate) return true;
      if (!v) return false;
      const d = v.slice(0, 10);
      return (!de || d >= de) && (!ate || d <= ate);
    };
    return leads.filter((l) => {
      if (s) {
        const hit = l.nome.toLowerCase().includes(s) || (l.email ?? "").toLowerCase().includes(s)
          || (digits.length >= 3 && (l.telefone ?? "").replace(/\D/g, "").includes(digits));
        if (!hit) return false;
      }
      if (f.status && l.call_status !== f.status) return false;
      if (f.fonte && l.fonte !== f.fonte) return false;
      if (f.sdr && l.sdr_member_id !== f.sdr) return false;
      if (f.closer && l.responsavel_member_id !== f.closer) return false;
      if (f.qual && l.qualificacao !== f.qual) return false;
      if (f.produto && l.produto !== f.produto) return false;
      if (f.metodo && l.metodo_pagamento !== f.metodo) return false;
      if (f.vmin && Number(l.preco ?? 0) < Number(f.vmin)) return false;
      if (f.vmax && Number(l.preco ?? 0) > Number(f.vmax)) return false;
      if (periodo !== "todos") {
        if (!l.call_at) return false;
        const d = isoLocal(new Date(l.call_at));
        if ((pDe && d < pDe) || (pAte && d > pAte)) return false;
      }
      if (!inR(l.data_prevista_fechamento, f.fechoDe, f.fechoAte)) return false;
      if (!inR(l.proximo_followup, f.fuDe, f.fuAte)) return false;
      return true;
    });
  }, [leads, q, f, periodo, pDe, pAte]);

  const contagens = useMemo(
    () => Object.fromEntries(FILTROS_RAPIDOS.map((r) => [r.key, base.filter((l) => r.match(l.call_status ?? "")).length])),
    [base],
  );

  const lista = useMemo(() => {
    const r = FILTROS_RAPIDOS.find((x) => x.key === rapido);
    if(!r)return [];
    const arr = base.filter((l) => r.match(l.call_status ?? ""));
    const dt = (l: Lead) => l.call_at ?? l.created_at;
    return [...arr].sort((a, b) => {
      switch (ordem) {
        case "atualizado": return b.updated_at.localeCompare(a.updated_at);
        case "valor_desc": return Number(b.preco ?? 0) - Number(a.preco ?? 0);
        case "valor_asc": return Number(a.preco ?? 0) - Number(b.preco ?? 0);
        case "previsao": return (a.data_prevista_fechamento ?? "9999").localeCompare(b.data_prevista_fechamento ?? "9999");
        default: return dt(b).localeCompare(dt(a));
      }
    });
  }, [base, rapido, ordem]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const lbl = "block text-[10px] uppercase font-semibold mb-1";
  const limpar = () => { setF(F0); setPeriodo("todos"); setQ(""); setOrdem("data"); };
  const clr = (...ks: (keyof typeof f)[]) => () => setF((p) => ({ ...p, ...Object.fromEntries(ks.map((k) => [k, ""])) }));
  const fd = (d: string) => (d ? d.split("-").reverse().join("/") : "…");
  const avancados: { k: keyof typeof f; label: string }[] = [
    { k: "status", label: `Status: ${callStatusInfo(f.status).label}` },
    { k: "fonte", label: `Fonte: ${f.fonte}` },
    { k: "qual", label: `Qualificação: ${QUALIFICACAO.find((x) => x.key === f.qual)?.label ?? f.qual}` },
    { k: "produto", label: `Produto: ${f.produto}` },
    { k: "metodo", label: `Método: ${f.metodo}` },
    { k: "vmin", label: `Valor mín.: ${f.vmin}` },
    { k: "vmax", label: `Valor máx.: ${f.vmax}` },
    { k: "fechoDe", label: `Fecho de: ${fd(f.fechoDe)}` },
    { k: "fechoAte", label: `Fecho até: ${fd(f.fechoAte)}` },
    { k: "fuDe", label: `Follow-up de: ${fd(f.fuDe)}` },
    { k: "fuAte", label: `Follow-up até: ${fd(f.fuAte)}` },
  ].filter((a) => f[a.k as keyof typeof f]) as { k: keyof typeof f; label: string }[];
  const nAvancados = avancados.length;
  const chips: { k: string; label: string; clear: () => void }[] = [
    ...(periodo !== "todos" ? [{ k: "periodo", label: periodo === "custom" ? `Período: ${fd(f.callDe)} – ${fd(f.callAte)}` : `Período: ${PERIODO_LABEL[periodo]}`, clear: () => { setPeriodo("todos"); clr("callDe", "callAte")(); } }] : []),
    ...(f.closer ? [{ k: "closer", label: `Closer: ${nomeDe[f.closer] ?? "—"}`, clear: clr("closer") }] : []),
    ...(f.sdr ? [{ k: "sdr", label: `SDR: ${nomeDe[f.sdr] ?? "—"}`, clear: clr("sdr") }] : []),
    ...avancados.map((a) => ({ k: a.k, label: a.label, clear: clr(a.k) })),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Central de Leads</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--text2)" }}>
            Base central de todos os leads agendados e seus respectivos resultados comerciais.
          </p>
        </div>
        <div className="flex gap-2">
        {(management || role==="sdr") && <Button className="eda-btn" onClick={()=>setCallLead("new")}>Marcar call</Button>}
        <Button className="eda-btn flex items-center gap-2" onClick={() => setNovo(true)}>
          <Plus size={14} /> Adicionar Lead
        </Button></div>
      </header>

      <div className="flex flex-wrap gap-2.5">
        {FILTROS_RAPIDOS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRapido(r.key)}
            aria-pressed={rapido === r.key}
            className="text-xs px-3.5 py-2 rounded-full"
            style={{
              background: rapido === r.key ? "var(--accent)" : "var(--surface2)",
              color: rapido === r.key ? "var(--sidebar-bg)" : "var(--text2)",
              border: "1px solid var(--border)",
              fontWeight: rapido === r.key ? 600 : 400,
            }}
          >
            {r.label} ({contagens[r.key] ?? 0})
          </button>
        ))}
      </div>

      <div className="eda-card space-y-4" style={{ padding: 24, marginBottom: 8 }}>
        <div className="relative w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text3)" }} />
          <input className="eda-input w-full" style={{ paddingLeft: 32 }} placeholder="Pesquisar por nome, telefone ou e-mail..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-end gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          <div className="shrink-0"><label className={lbl} style={{ color: "var(--text3)" }}>Período</label>
            <select className="eda-input" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
              {Object.entries(PERIODO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {periodo === "custom" && (<>
            <div className="shrink-0"><label className={lbl} style={{ color: "var(--text3)" }}>Data inicial</label><input type="date" className="eda-input" value={f.callDe} onChange={set("callDe")} /></div>
            <div className="shrink-0"><label className={lbl} style={{ color: "var(--text3)" }}>Data final</label><input type="date" className="eda-input" value={f.callAte} onChange={set("callAte")} /></div>
          </>)}
          <div className="shrink-0"><label className={lbl} style={{ color: "var(--text3)" }}>Closer</label>
            <select className="eda-input" value={f.closer} onChange={set("closer")}><option value="">Todos</option>{closers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></div>
          <div className="shrink-0"><label className={lbl} style={{ color: "var(--text3)" }}>SDR</label>
            <select className="eda-input" value={f.sdr} onChange={set("sdr")}><option value="">Todos</option>{sdrs.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></div>
          <button type="button" className="eda-btn-ghost text-xs shrink-0" onClick={() => setVerAvancados((v) => !v)} aria-expanded={verAvancados}>
            {verAvancados ? "Esconder filtros" : "Mais filtros"}{nAvancados > 0 ? ` (${nAvancados})` : ""}
          </button>
          {chips.length > 0 && (
            <button type="button" className="text-xs underline shrink-0 py-2" style={{ color: "var(--text2)" }} onClick={limpar}>Limpar filtros</button>
          )}
        </div>
        {verAvancados && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Status</label>
              <select className="eda-input w-full" value={f.status} onChange={set("status")}><option value="">Todos</option>{CALL_STATUS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Fonte</label>
              <select className="eda-input w-full" value={f.fonte} onChange={set("fonte")}><option value="">Todas</option>{FONTES.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Qualificação</label>
              <select className="eda-input w-full" value={f.qual} onChange={set("qual")}><option value="">Todas</option>{QUALIFICACAO.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Produto</label>
              <select className="eda-input w-full" value={f.produto} onChange={set("produto")}><option value="">Todos</option>{PRODUTOS.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Método</label>
              <select className="eda-input w-full" value={f.metodo} onChange={set("metodo")}><option value="">Todos</option>{METODOS.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Ordenar por</label>
              <select className="eda-input w-full" value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)}>
                <option value="data">Data da call</option>
                <option value="atualizado">Última atualização</option>
                <option value="valor_desc">Maior valor</option>
                <option value="valor_asc">Menor valor</option>
                <option value="previsao">Previsão de fecho</option>
              </select></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Valor mín.</label><input className="eda-input w-full" inputMode="decimal" value={f.vmin} onChange={set("vmin")} /></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Valor máx.</label><input className="eda-input w-full" inputMode="decimal" value={f.vmax} onChange={set("vmax")} /></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Fecho de</label><input type="date" className="eda-input w-full" value={f.fechoDe} onChange={set("fechoDe")} /></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Fecho até</label><input type="date" className="eda-input w-full" value={f.fechoAte} onChange={set("fechoAte")} /></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Follow-up de</label><input type="date" className="eda-input w-full" value={f.fuDe} onChange={set("fuDe")} /></div>
            <div><label className={lbl} style={{ color: "var(--text3)" }}>Follow-up até</label><input type="date" className="eda-input w-full" value={f.fuAte} onChange={set("fuAte")} /></div>
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c.k} className="text-[11px] pl-2.5 pr-1 py-1 rounded-full flex items-center gap-1" style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)" }}>
                {c.label}
                <button type="button" aria-label={`Remover ${c.label}`} onClick={c.clear} className="p-0.5 rounded-full hover:opacity-70"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="eda-card overflow-x-auto" style={{ padding: 0 }}>
        <table className="w-full text-sm" style={{ minWidth: 1900 }}>
          <thead>
            <tr className="text-left text-[11px] uppercase" style={{ color: "var(--text2)", background: "var(--surface2)" }}>
              {["Data", "Nome", "Contacto", "Fonte", "Closer", "SDR", "Status", "Qualificação", "Produto", "Valor", "Sinal", "Previsão", "Próx. follow-up", "Método", "Call", "Atualizado", "Ação"].map((h, i) => (
                <th key={h} className={`px-4 py-4 font-semibold tracking-[.1em] whitespace-nowrap ${i === 6 ? "text-center" : ""}`} style={{ borderBottom: "1px solid var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.id} className="border-t align-middle" style={{ borderColor: "var(--border)", height: 56 }}>
                <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "var(--text2)" }}>{fmtDateTime(l.call_at)}</td>
                <td className="px-4 py-3" style={{ minWidth: 220 }}>
                  <button className="font-semibold text-left hover:underline leading-snug" style={{ color: "var(--text)", fontSize: 14 }} onClick={() => setAbrir(l)}>{l.nome}</button>
                  {pendente(l) && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase whitespace-nowrap" style={{ color: "var(--gold)" }}>
                      <AlertTriangle size={11} /> Status não atualizado
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs leading-relaxed" style={{ color: "var(--text3)", minWidth: 210 }}>
                  {l.telefone && <div className="whitespace-nowrap">{l.telefone}</div>}
                  {l.email && <div className="truncate max-w-[220px]">{l.email}</div>}
                  {!l.telefone && !l.email && "—"}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--text2)" }}>{l.fonte ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap font-medium" style={{ color: "var(--text)" }}>{l.responsavel_member_id ? nomeDe[l.responsavel_member_id] ?? "—" : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--text2)" }}>{l.sdr_member_id ? nomeDe[l.sdr_member_id] ?? "—" : "—"}</td>
                <td className="px-4 py-3 text-center whitespace-nowrap"><StatusTag s={l.call_status} /></td>
                <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--text2)" }}>{QUALIFICACAO.find((x) => x.key === l.qualificacao)?.label ?? "—"}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">{l.produto ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{Number(l.preco ?? 0) > 0 ? eur(Number(l.preco)) : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--gold)" }}>{Number(l.valor_sinal) > 0 ? eur(Number(l.valor_sinal)) : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{l.data_prevista_fechamento ? fmtDate(l.data_prevista_fechamento) : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{l.proximo_followup ? fmtDate(l.proximo_followup) : "—"}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">{l.metodo_pagamento ?? "—"}</td>
                <td className="px-4 py-3">
                  {l.link_call ? (
                    <a href={l.link_call} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: "var(--accent)" }}>
                      <Video size={13} /> Ver call
                    </a>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--text3)" }}>{fmtDate(l.updated_at)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button className="p-2 rounded hover:bg-[var(--surface2)]" title="Abrir" aria-label="Abrir" onClick={() => setAbrir(l)}><Eye size={15} /></button>
                  {(management || role==="sdr") && <Button variant="ghost" aria-label={`Marcar call de ${l.nome}`} onClick={()=>setCallLead(l)}><Video size={15}/></Button>}
                  {management && <Button variant="ghost" aria-label={`Apagar lead ${l.nome}`} onClick={()=>removeLead(l)}><Trash2 size={15}/></Button>}
                  <button className="p-2 rounded hover:bg-[var(--surface2)]" title="Atualizar" aria-label="Atualizar" onClick={() => setEditar(l)}><Pencil size={15} /></button>
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={17} className="py-10 text-center" style={{ color: "var(--text3)" }}>Sem leads nesta visão.</td></tr>}
          </tbody>
        </table>
      </div>

      {callLead && <CallForm lead={callLead==="new"?undefined:callLead} onClose={()=>setCallLead(null)}/>}
      {(novo || editar) && (
        <LeadForm
          lead={editar}
          role={role}
          myMemberId={myMemberId}
          userId={profile?.profile?.id as string | undefined}
          onClose={() => { setNovo(false); setEditar(null); }}
        />
      )}
      {abrir && <LeadPanel lead={abrir} nomeDe={nomeDe} onClose={() => setAbrir(null)} onEdit={() => { setEditar(abrir); setAbrir(null); }} />}
    </div>
  );
}

// ---------------- Formulário (nova call / atualizar) ----------------
function LeadForm({ lead, role, myMemberId, userId, onClose }: {
  lead: Lead | null; role?: string; myMemberId?: string; userId?: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { closers, sdrs } = useMembrosDir();
  const isNovo = !lead;
  const [v, setV] = useState({
    nome: lead?.nome ?? "",
    telefone: lead?.telefone ?? "",
    email: lead?.email ?? "",
    fonte: lead?.fonte ?? "",
    sdr: lead?.sdr_member_id ?? (role === "sdr" ? myMemberId ?? "" : ""),
    closer: lead?.responsavel_member_id ?? (role === "closer" ? myMemberId ?? "" : ""),
    call_at: toLocalInput(lead?.call_at ?? null),
    produto: lead?.produto ?? "",
    briefing: lead?.briefing ?? "",
    observacoes: lead?.observacoes ?? "",
    call_status: lead?.call_status ?? "follow_up",
    qualificacao: lead?.qualificacao ?? "nao_definido",
    preco: Number(lead?.preco ?? 0),
    valor_sinal: Number(lead?.valor_sinal ?? 0),
    metodo: lead?.metodo_pagamento ?? "",
    previsao: lead?.data_prevista_fechamento ?? "",
    proximo: lead?.proximo_followup ?? "",
    link: lead?.link_call ?? "",
    motivo: lead?.motivo_desqualificacao ?? "",
  });
  const up = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const precisaMotivo = v.call_status === "desqualificado" || v.qualificacao === "desqualificado";

  const save = useMutation({
    mutationFn: async () => {
      if (!v.nome.trim()) throw new Error("Nome é obrigatório.");
      if (!v.telefone.trim()) throw new Error("Telefone é obrigatório.");

      if (v.call_status === "reagendado" && lead && toLocalInput(lead.call_at) === v.call_at)
        throw new Error("Reagendado: indica a nova data e hora da reunião.");
      if (!isNovo && v.call_status === "follow_up" && !v.proximo) throw new Error("Follow-up: indica a data do próximo contacto.");
      if (precisaMotivo && !v.motivo) throw new Error("Indica o motivo da desqualificação.");
      const payload: Record<string, unknown> = {
        nome: v.nome.trim(),
        telefone: v.telefone.trim(),
        email: v.email.trim() || null,
        fonte: v.fonte || null,
        sdr_member_id: v.sdr || null,
        responsavel_member_id: v.closer || null,
        call_at: v.call_at ? new Date(v.call_at).toISOString() : null,
        produto: v.produto || null,
        briefing: v.briefing || null,
        observacoes: v.observacoes || null,
        call_status: v.call_status,
        status: legacyStatus(v.call_status),
        qualificacao: v.qualificacao,
        preco: v.preco || null,
        valor_sinal: v.valor_sinal || 0,
        metodo_pagamento: v.metodo || null,
        data_prevista_fechamento: v.previsao || null,
        proximo_followup: v.proximo || null,
        link_call: v.link.trim() || null,
        motivo_desqualificacao: precisaMotivo ? v.motivo : null,
        updated_by: userId ?? null,
      };
      if (isNovo) {
        const { error } = await supabase.from("leads_consolidados").insert({ ...payload, origem: "follow_up", created_by: userId } as never);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("leads_consolidados").update(payload as never).eq("id", lead?.id ?? "").select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Sem permissão para alterar este lead.");
      }
    },
    onSuccess: () => {
      toast.success(isNovo ? "Lead criado." : "Lead atualizado.");
      qc.invalidateQueries({ queryKey: ["leads_consolidados"] });
      onClose();
    },
    onError: (e: any) => toast.error(friendlyError(e)),
  });

  const lbl = "block text-[11px] uppercase tracking-wider mb-2";
  const L = ({ t, req }: { t: string; req?: boolean }) => <label className={lbl} style={{ color: "var(--text3)" }}>{t}{req && " *"}</label>;
  const sec = "text-[11px] uppercase tracking-[.12em] font-semibold col-span-full pt-2";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        className="eda-card w-full max-w-3xl my-8"
        style={{ padding: 24 }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold">{isNovo ? "Adicionar Lead" : `Atualizar — ${lead?.nome}`}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ color: "var(--text3)" }}><X size={16} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <div className={sec} style={{ color: "var(--accent)" }}>Lead</div>
          <div><L t="Nome do lead" req /><input className="eda-input w-full" value={v.nome} onChange={up("nome")} /></div>
          <div><L t="Telefone" req /><input className="eda-input w-full" value={v.telefone} onChange={up("telefone")} /></div>
          <div><L t="E-mail" /><input type="email" className="eda-input w-full" value={v.email} onChange={up("email")} /></div>
          <div><L t="Fonte" /><select className="eda-input w-full" value={v.fonte} onChange={up("fonte")}><option value="">—</option>{FONTES.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><L t="SDR responsável" /><select className="eda-input w-full" value={v.sdr} onChange={up("sdr")}><option value="">—</option>{sdrs.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></div>
          <div><L t="Closer responsável" /><select className="eda-input w-full" value={v.closer} onChange={up("closer")}><option value="">—</option>{closers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></div>

          <div><L t="Produto / interesse" /><select className="eda-input w-full" value={v.produto} onChange={up("produto")}><option value="">—</option>{PRODUTOS.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="col-span-full"><L t="Briefing" /><textarea className="eda-input w-full" rows={2} value={v.briefing} onChange={up("briefing")} /></div>

          {!isNovo && (
            <>
              <div className={sec} style={{ color: "var(--accent)" }}>Resultado da call</div>
              <div><L t="Status" req /><select className="eda-input w-full" value={v.call_status} onChange={up("call_status")}>{CALL_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
              <div><L t="Qualificação" /><select className="eda-input w-full" value={v.qualificacao} onChange={up("qualificacao")}>{QUALIFICACAO.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
              {precisaMotivo && (
                <div className="col-span-full"><L t="Motivo da desqualificação" req /><select className="eda-input w-full" value={v.motivo} onChange={up("motivo")}><option value="">—</option>{MOTIVOS_DESQ.map((x) => <option key={x}>{x}</option>)}</select></div>
              )}
              <div><L t="Valor da venda (€)" /><NumInput value={v.preco} onChange={(n) => setV({ ...v, preco: n })} step="0.01" /></div>
              <div><L t="Valor do sinal (€)" /><NumInput value={v.valor_sinal} onChange={(n) => setV({ ...v, valor_sinal: n })} step="0.01" /></div>
              <div><L t="Método de pagamento" /><select className="eda-input w-full" value={v.metodo} onChange={up("metodo")}><option value="">—</option>{METODOS.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><L t="Previsão de fecho" /><input type="date" className="eda-input w-full" value={v.previsao} onChange={up("previsao")} /></div>
              <div><L t="Próximo follow-up" req={v.call_status === "follow_up"} /><input type="date" className="eda-input w-full" value={v.proximo} onChange={up("proximo")} /></div>
              <div><L t="Link da gravação" /><input className="eda-input w-full" placeholder="https://" value={v.link} onChange={up("link")} /></div>
              {v.call_status === "fechado" && (
                <p className="col-span-full text-xs" style={{ color: "var(--gold)" }}>
                  Lembra-te de registar a venda em "Registar Venda". Aqui só fica marcado o resultado do lead.
                </p>
              )}
            </>
          )}
          <div className="col-span-full"><L t="Observações" /><textarea className="eda-input w-full" rows={3} value={v.observacoes} onChange={up("observacoes")} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-7">
          <button type="button" className="eda-btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="eda-btn" disabled={save.isPending}>{isNovo ? "Criar lead" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------- Painel do lead ----------------
function LeadPanel({ lead: l, nomeDe, onClose, onEdit }: { lead: Lead; nomeDe: Record<string, string>; onClose: () => void; onEdit: () => void }) {
  const { data: hist = [] } = useQuery({
    queryKey: ["leads_consolidados_hist", l.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads_consolidados_hist" as never).select("*").eq("lead_id", l.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const saldo = Math.max(Number(l.preco ?? 0) - Number(l.valor_sinal ?? 0), 0);
  const Row = ({ k, val }: { k: string; val: React.ReactNode }) => (
    <div className="flex justify-between gap-3 py-1 text-sm"><span style={{ color: "var(--text3)" }}>{k}</span><span className="text-right">{val || "—"}</span></div>
  );
  const Sec = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="text-[11px] uppercase tracking-[.12em] font-semibold mb-1" style={{ color: "var(--accent)" }}>{t}</div>{children}
    </div>
  );
  const histTexto = (h: any) => {
    if (h.acao === "status") return `${callStatusInfo(h.de).label} → ${callStatusInfo(h.para).label}`;
    if (h.acao === "criado") return `Status: ${callStatusInfo(h.para).label}`;
    if (h.acao === "reagendado") return `de ${h.de} para ${h.para}`;
    if (h.acao === "sinal") return `${eur(Number(h.de ?? 0))} → ${eur(Number(h.para ?? 0))}`;
    return [h.de, h.para].filter(Boolean).join(" → ");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto p-5 space-y-3" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{l.nome}</h2>
            <div className="mt-1"><StatusTag s={l.call_status} /></div>
          </div>
          <div className="flex gap-2">
            <button className="eda-btn text-xs flex items-center gap-1" onClick={onEdit}><Pencil size={12} /> Atualizar</button>
            <button onClick={onClose} aria-label="Fechar" style={{ color: "var(--text3)" }}><X size={16} /></button>
          </div>
        </div>
        <Sec t="Lead"><Row k="Telefone" val={l.telefone} /><Row k="E-mail" val={l.email} /><Row k="Fonte" val={l.fonte} /></Sec>
        <Sec t="Responsáveis">
          <Row k="SDR" val={l.sdr_member_id ? nomeDe[l.sdr_member_id] : null} />
          <Row k="Closer" val={l.responsavel_member_id ? nomeDe[l.responsavel_member_id] : null} />
        </Sec>
        <Sec t="Call">
          <Row k="Data e hora" val={fmtDateTime(l.call_at)} />
          <Row k="Qualificação" val={QUALIFICACAO.find((x) => x.key === l.qualificacao)?.label} />
          {l.motivo_desqualificacao && <Row k="Motivo" val={l.motivo_desqualificacao} />}
          {l.noshow_count > 0 && <Row k="Faltas" val={`${l.noshow_count}${l.noshow_motivo ? ` · ${l.noshow_motivo}` : ""}`} />}
          <Row k="Gravação" val={l.link_call ? <a href={l.link_call} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Ver call</a> : null} />
        </Sec>
        <Sec t="Comercial">
          <Row k="Produto" val={l.produto} />
          <Row k="Valor acordado" val={Number(l.preco ?? 0) > 0 ? eur(Number(l.preco)) : null} />
          <Row k="Sinal" val={Number(l.valor_sinal) > 0 ? eur(Number(l.valor_sinal)) : null} />
          <Row k="Saldo pendente" val={Number(l.preco ?? 0) > 0 ? eur(saldo) : null} />
          <Row k="Método" val={l.metodo_pagamento} />
          <Row k="Previsão de fecho" val={l.data_prevista_fechamento ? fmtDate(l.data_prevista_fechamento) : null} />
        </Sec>
        <Sec t="Follow-up"><Row k="Próximo contacto" val={l.proximo_followup ? fmtDate(l.proximo_followup) : null} /></Sec>
        <Sec t="Briefing"><p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{l.briefing || "—"}</p></Sec>
        <Sec t="Observações"><p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{l.observacoes || "—"}</p></Sec>
        <Sec t="Histórico">
          <div className="space-y-2">
            {hist.map((h) => (
              <div key={h.id} className="text-xs">
                <div style={{ color: "var(--text3)" }}>{fmtDateTime(h.created_at)}{h.actor_nome ? ` · ${h.actor_nome}` : ""}</div>
                <div><span className="font-semibold">{HIST_LABEL[h.acao] ?? h.acao}</span> {histTexto(h)}</div>
              </div>
            ))}
            {!hist.length && <div className="text-xs" style={{ color: "var(--text3)" }}>Sem alterações registadas desde a criação da Central.</div>}
          </div>
        </Sec>
      </aside>
    </div>
  );
}
