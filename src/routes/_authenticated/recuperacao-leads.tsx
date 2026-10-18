import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useAuth";
import { eur, fmtDate } from "@/lib/format";
import { friendlyError } from "@/lib/rls-error";
import {
  STATUS_META, STATUS_ORDER, CANAL_META,
  normalizePhone, whatsappLink, parseCSV, parseBrDate, isOverdueRecovery,
  type RecoveryLead, type RecoveryStatus, type RecoveryCanal, type RecoveryInteraction,
} from "@/lib/recovery";
import {
  Copy, MessageCircle, Upload, X, Phone, Send, Instagram, CheckCircle2,
  CalendarClock, Users, Target, Euro, AlertTriangle, Plus,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/recuperacao-leads")({
  component: RecuperacaoLeadsPage,
});

type QuickFU = "todos" | "hoje" | "atrasados" | "semana";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RecuperacaoLeadsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: prof } = useProfile();
  const role = prof?.role ?? "sdr";

  const { data: leads = [] } = useQuery({
    queryKey: ["recovery_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recovery_leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RecoveryLead[];
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return (data ?? []) as { id: string; nome: string; role: string; ativo: boolean }[];
    },
  });
  const memberName = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.nome])), [members]);

  // Filtros
  const [fStatus, setFStatus] = useState<RecoveryStatus | "">("");
  const [fResp, setFResp] = useState<string>("");
  const [fFU, setFFU] = useState<QuickFU>("todos");
  const [fTicketMin, setFTicketMin] = useState<string>("");
  const [fTicketMax, setFTicketMax] = useState<string>("");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const now = new Date();
    const todayStr = todayISO();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return leads.filter((l) => {
      if (fStatus && l.status !== fStatus) return false;
      if (fResp && l.responsavel_id !== fResp) return false;
      if (fFU === "hoje" && l.proximo_followup !== todayStr) return false;
      if (fFU === "atrasados" && !isOverdueRecovery(l.proximo_followup)) return false;
      if (fFU === "semana") {
        if (!l.proximo_followup) return false;
        const d = new Date(l.proximo_followup + "T00:00:00");
        if (d < new Date(todayStr + "T00:00:00") || d > weekEnd) return false;
      }
      const t = Number(l.valor_ticket) || 0;
      if (fTicketMin && t < Number(fTicketMin)) return false;
      if (fTicketMax && t > Number(fTicketMax)) return false;
      if (q) {
        const s = q.toLowerCase();
        if (!l.nome.toLowerCase().includes(s) && !normalizePhone(l.numero).includes(normalizePhone(q))) return false;
      }
      return true;
    });
  }, [leads, fStatus, fResp, fFU, fTicketMin, fTicketMax, q]);

  // Cards de resumo
  const summary = useMemo(() => {
    const today = todayISO();
    const contactadosHoje = leads.filter(
      (l) => l.ultimo_contacto_at && l.ultimo_contacto_at.slice(0, 10) === today,
    ).length;
    const atrasados = leads.filter((l) => isOverdueRecovery(l.proximo_followup) && l.status !== "fechou" && l.status !== "perdido" && l.status !== "nao_perturbar").length;
    const agendadas = leads.filter((l) => l.status === "call_agendada").length;
    const fechados = leads.filter((l) => l.status === "fechou");
    return {
      total: leads.length,
      contactadosHoje,
      atrasados,
      agendadas,
      fechadosCount: fechados.length,
      fechadosValor: fechados.reduce((a, b) => a + (Number(b.valor_ticket) || 0), 0),
    };
  }, [leads]);

  // Selected lead panel
  const [openLead, setOpenLead] = useState<RecoveryLead | null>(null);

  // Import modal
  const [importOpen, setImportOpen] = useState(false);

  // New lead modal
  const [newOpen, setNewOpen] = useState(false);

  const setStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RecoveryStatus }) => {
      const { error } = await supabase.from("recovery_leads").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["recovery_leads"] });
      const lead = leads.find((l) => l.id === vars.id);
      if (vars.status === "fechou" && lead) {
        if (confirm(`Registar venda de ${lead.nome} agora em "Registar Venda"?`)) {
          navigate({
            to: "/vendas",
            search: {
              nome: lead.nome,
              tel: lead.numero,
              ticket: String(lead.valor_ticket ?? ""),
            } as any,
          });
        }
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const setFieldMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<RecoveryLead> }) => {
      const { error } = await supabase.from("recovery_leads").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recovery_leads"] }),
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  function copyNumero(n: string) {
    navigator.clipboard.writeText(n).then(() => toast.success("Número copiado."));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Recuperação de Leads</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
            Base de leads antigos que fizeram call e não fecharam — a reativar do zero.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportOpen(true)} className="eda-btn-secondary flex items-center gap-2">
            <Upload size={14} /> Importar CSV
          </button>
          <button onClick={() => setNewOpen(true)} className="eda-btn flex items-center gap-2">
            <Plus size={14} /> Novo lead
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SumCard label="Total na base" value={summary.total} icon={Users} color="var(--accent)" />
        <SumCard label="Contactados hoje" value={summary.contactadosHoje} icon={CheckCircle2} color="var(--gold)" />
        <SumCard label="Follow-ups atrasados" value={summary.atrasados} icon={AlertTriangle} color="var(--red)" />
        <SumCard label="Calls agendadas" value={summary.agendadas} icon={CalendarClock} color="#f97316" />
        <SumCard
          label="Fechados"
          value={`${summary.fechadosCount} · ${eur(summary.fechadosValor)}`}
          icon={Target}
          color="#22c55e"
        />
      </div>

      {/* Filtros */}
      <div className="eda-card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3" style={{ padding: 14 }}>
        <input className="eda-input" placeholder="Buscar por nome ou número…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="eda-input" value={fStatus} onChange={(e) => setFStatus(e.target.value as any)}>
          <option value="">Todos status</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select className="eda-input" value={fResp} onChange={(e) => setFResp(e.target.value)}>
          <option value="">Todos responsáveis</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <select className="eda-input" value={fFU} onChange={(e) => setFFU(e.target.value as QuickFU)}>
          <option value="todos">Todos follow-ups</option>
          <option value="hoje">Hoje</option>
          <option value="atrasados">Atrasados</option>
          <option value="semana">Esta semana</option>
        </select>
        <input className="eda-input" placeholder="Ticket mín €" type="number" value={fTicketMin} onChange={(e) => setFTicketMin(e.target.value)} />
        <input className="eda-input" placeholder="Ticket máx €" type="number" value={fTicketMax} onChange={(e) => setFTicketMax(e.target.value)} />
      </div>

      {/* Tabela */}
      <div className="eda-card overflow-x-auto" style={{ padding: 0 }}>
        <table className="eda-table w-full text-sm">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Número</th>
              <th>Ticket</th>
              <th>1ª call</th>
              <th>Calls reat.</th>
              <th>FU msg</th>
              <th>Último contacto</th>
              <th>Próx. FU</th>
              <th>Status</th>
              <th>Responsável</th>
              <th>Sinal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="text-center py-8" style={{ color: "var(--text3)" }}>Sem leads que correspondam ao filtro.</td></tr>
            )}
            {filtered.map((l) => {
              const overdue = isOverdueRecovery(l.proximo_followup);
              const meta = STATUS_META[l.status];
              return (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td>
                    <button onClick={() => setOpenLead(l)} className="text-left underline-offset-2 hover:underline" style={{ color: "var(--text)" }}>
                      {l.nome}
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="tabular-nums">{l.numero}</span>
                      <button title="Copiar" aria-label="Copiar número" onClick={() => copyNumero(l.numero)} className="p-1 rounded hover:bg-[var(--surface2)]"><Copy size={12} /></button>
                      <a title="WhatsApp" aria-label="Abrir conversa no WhatsApp" href={whatsappLink(l.numero)} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-[var(--surface2)]" style={{ color: "#25d366" }}><MessageCircle size={12} /></a>
                    </div>
                  </td>
                  <td>{eur(Number(l.valor_ticket) || 0)}</td>
                  <td>{l.data_primeira_call ? fmtDate(l.data_primeira_call) : "—"}</td>
                  <td className="text-center">{l.calls_reativacao}</td>
                  <td className="text-center">{l.followups_mensagem}</td>
                  <td>
                    {l.ultimo_contacto_at ? (
                      <span>
                        {fmtDate(l.ultimo_contacto_at.slice(0, 10))}
                        {l.ultimo_contacto_canal && (
                          <span className="ml-1 text-[10px] uppercase" style={{ color: "var(--text3)" }}>
                            · {CANAL_META[l.ultimo_contacto_canal]}
                          </span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    <input
                      type="date"
                      className="eda-input"
                      style={{ padding: "4px 6px", fontSize: 12, background: overdue ? "rgba(239,68,68,0.15)" : undefined, color: overdue ? "#ef4444" : undefined, borderColor: overdue ? "#ef4444" : undefined }}
                      value={l.proximo_followup ?? ""}
                      onChange={(e) => setFieldMut.mutate({ id: l.id, patch: { proximo_followup: e.target.value || null } })}
                    />
                  </td>
                  <td>
                    <select
                      value={l.status}
                      onChange={(e) => setStatusMut.mutate({ id: l.id, status: e.target.value as RecoveryStatus })}
                      style={{
                        background: meta.color,
                        color: meta.text,
                        border: "none",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {STATUS_ORDER.map((s) => <option key={s} value={s} style={{ background: "var(--surface)", color: "var(--text)" }}>{STATUS_META[s].label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className="eda-input"
                      style={{ padding: "4px 6px", fontSize: 12 }}
                      value={l.responsavel_id ?? ""}
                      onChange={(e) => setFieldMut.mutate({ id: l.id, patch: { responsavel_id: e.target.value || null } })}
                    >
                      <option value="">—</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </td>
                  <td className="tabular-nums">{Number(l.sinal_dado) > 0 ? eur(Number(l.sinal_dado)) : "—"}</td>
                  <td>
                    <button onClick={() => setOpenLead(l)} className="eda-btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}>Abrir</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openLead && (
        <LeadPanel
          lead={openLead}
          onClose={() => setOpenLead(null)}
          members={members}
          role={role}
        />
      )}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} existingNumbers={new Set(leads.map((l) => normalizePhone(l.numero)))} />}
      {newOpen && <NewLeadModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function SumCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: typeof Users; color: string }) {
  return (
    <div className="eda-card" style={{ padding: 14 }}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider" style={{ color }}>
        <Icon size={13} /> {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

// -------------------- Lead panel --------------------

function LeadPanel({
  lead, onClose, members, role,
}: {
  lead: RecoveryLead;
  onClose: () => void;
  members: { id: string; nome: string }[];
  role: string;
}) {
  const qc = useQueryClient();
  const memberName = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.nome])), [members]);

  const { data: interactions = [] } = useQuery({
    queryKey: ["recovery_interactions", lead.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recovery_interactions")
        .select("*")
        .eq("lead_id", lead.id)
        .order("ocorrido_em", { ascending: false });
      if (error) throw error;
      return data as RecoveryInteraction[];
    },
  });

  const [canal, setCanal] = useState<RecoveryCanal>("whatsapp");
  const [nota, setNota] = useState("");
  const [obs, setObs] = useState(lead.observacoes ?? "");

  const addInt = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("recovery_interactions").insert({
        lead_id: lead.id,
        canal,
        nota: nota || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Interação registada.");
      setNota("");
      qc.invalidateQueries({ queryKey: ["recovery_interactions", lead.id] });
      qc.invalidateQueries({ queryKey: ["recovery_leads"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const saveObs = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("recovery_leads").update({ observacoes: obs }).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Observações guardadas."); qc.invalidateQueries({ queryKey: ["recovery_leads"] }); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("recovery_leads").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Lead removido."); qc.invalidateQueries({ queryKey: ["recovery_leads"] }); onClose(); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/60" />
      <div className="w-full max-w-[520px] h-full overflow-y-auto" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-bold">{lead.nome}</div>
              <div className="text-sm mt-1" style={{ color: "var(--text2)" }}>
                {lead.numero}
                <a href={whatsappLink(lead.numero)} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1" style={{ color: "#25d366" }}>
                  <MessageCircle size={12} /> WhatsApp
                </a>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--surface2)]"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4 text-xs" style={{ color: "var(--text2)" }}>
            <div>Ticket: <span style={{ color: "var(--text)" }}>{eur(Number(lead.valor_ticket) || 0)}</span></div>
            <div>1ª call: <span style={{ color: "var(--text)" }}>{lead.data_primeira_call ? fmtDate(lead.data_primeira_call) : "—"}</span></div>
            <div>Calls reativação: <span style={{ color: "var(--text)" }}>{lead.calls_reativacao}</span></div>
            <div>Follow-ups msg: <span style={{ color: "var(--text)" }}>{lead.followups_mensagem}</span></div>
            <div>Sinal dado: <span style={{ color: "var(--text)" }}>{Number(lead.sinal_dado) > 0 ? eur(Number(lead.sinal_dado)) : "—"}</span></div>
            <div>Origem: <span style={{ color: "var(--text)" }}>{lead.origem ?? "—"}</span></div>
          </div>
        </div>

        <div className="p-5 space-y-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text3)" }}>Observações</div>
            <textarea className="eda-input w-full" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
            <button onClick={() => saveObs.mutate()} className="eda-btn-secondary mt-2" style={{ padding: "4px 10px", fontSize: 12 }}>Guardar</button>
          </div>
        </div>

        <div className="p-5 space-y-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text3)" }}>Registar interação</div>
          <div className="flex flex-wrap gap-2">
            {(["call","whatsapp","instagram"] as RecoveryCanal[]).map((c) => {
              const Icon = c === "call" ? Phone : c === "whatsapp" ? Send : Instagram;
              const active = canal === c;
              return (
                <button
                  key={c}
                  onClick={() => setCanal(c)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                  style={{
                    background: active ? "var(--accent)" : "var(--surface2)",
                    color: active ? "#0b1220" : "var(--text)",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  <Icon size={12} /> {CANAL_META[c]}
                </button>
              );
            })}
          </div>
          <textarea className="eda-input w-full" rows={2} placeholder="Nota curta…" value={nota} onChange={(e) => setNota(e.target.value)} />
          <button onClick={() => addInt.mutate()} disabled={addInt.isPending} className="eda-btn">
            Registar {canal === "call" ? "call" : "mensagem"}
          </button>
          <div className="text-[11px]" style={{ color: "var(--text3)" }}>
            Os contadores atualizam-se automaticamente com base no canal.
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text3)" }}>Histórico</div>
          {interactions.length === 0 && <div className="text-sm" style={{ color: "var(--text3)" }}>Sem interações ainda.</div>}
          <ul className="space-y-3">
            {interactions.map((i) => (
              <li key={i.id} className="text-sm border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text3)" }}>
                  <span className="uppercase">{CANAL_META[i.canal]}</span>
                  <span>·</span>
                  <span>{new Date(i.ocorrido_em).toLocaleString("pt-PT")}</span>
                  {i.autor_member_id && <span>· {memberName[i.autor_member_id] ?? ""}</span>}
                </div>
                {i.nota && <div className="mt-1">{i.nota}</div>}
              </li>
            ))}
          </ul>

          {role === "socio" && (
            <button
              onClick={() => { if (confirm(`Apagar o lead ${lead.nome}? Esta ação é permanente.`)) del.mutate(); }}
              className="mt-6 text-xs"
              style={{ color: "var(--red)" }}
            >
              Apagar lead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------- New lead modal --------------------

function NewLeadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: "",
    numero: "",
    valor_ticket: "",
    data_primeira_call: "",
    sinal_dado: "",
    observacoes: "",
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim() || !form.numero.trim()) throw new Error("Nome e número são obrigatórios.");
      const { error } = await supabase.from("recovery_leads").insert({
        nome: form.nome.trim(),
        numero: form.numero.trim(),
        valor_ticket: Number(form.valor_ticket) || 0,
        data_primeira_call: form.data_primeira_call || null,
        sinal_dado: Number(form.sinal_dado) || 0,
        observacoes: form.observacoes || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Lead criado."); qc.invalidateQueries({ queryKey: ["recovery_leads"] }); onClose(); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="eda-card w-full max-w-md" style={{ padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Novo lead de recuperação</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-xs" style={{ color: "var(--text2)" }}>Nome *</label><input className="eda-input w-full mt-1" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label className="text-xs" style={{ color: "var(--text2)" }}>Número *</label><input className="eda-input w-full mt-1" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs" style={{ color: "var(--text2)" }}>Ticket €</label><input type="number" className="eda-input w-full mt-1" value={form.valor_ticket} onChange={(e) => setForm({ ...form, valor_ticket: e.target.value })} /></div>
            <div><label className="text-xs" style={{ color: "var(--text2)" }}>1ª call</label><input type="date" className="eda-input w-full mt-1" value={form.data_primeira_call} onChange={(e) => setForm({ ...form, data_primeira_call: e.target.value })} /></div>
          </div>
          <div><label className="text-xs" style={{ color: "var(--text2)" }}>Sinal já dado €</label><input type="number" className="eda-input w-full mt-1" value={form.sinal_dado} onChange={(e) => setForm({ ...form, sinal_dado: e.target.value })} /></div>
          <div><label className="text-xs" style={{ color: "var(--text2)" }}>Observações</label><textarea rows={2} className="eda-input w-full mt-1" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
          <button className="eda-btn w-full" disabled={create.isPending} onClick={() => create.mutate()}>Criar</button>
        </div>
      </div>
    </div>
  );
}

// -------------------- Import CSV modal --------------------

type ImportRow = {
  nome: string;
  numero: string;
  valor_ticket: number;
  data_primeira_call: string | null;
  sinal_dado: number;
  observacoes: string | null;
  origem: string | null;
  duplicated: boolean;
};

function ImportModal({ onClose, existingNumbers }: { onClose: () => void; existingNumbers: Set<string> }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [skipDup, setSkipDup] = useState(true);

  function handleFile(f: File) {
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = parseCSV(text);
      if (parsed.length === 0) { toast.error("CSV vazio."); return; }
      const header = parsed[0].map((h) => h.trim().toLowerCase());
      const idx = {
        nome: header.indexOf("nome"),
        numero: header.indexOf("numero"),
        valor_ticket: header.indexOf("valor_ticket"),
        data_primeira_call: header.indexOf("data_primeira_call"),
        sinal_dado: header.indexOf("sinal_dado"),
        observacoes: header.indexOf("observacoes"),
        origem: header.indexOf("origem"),
      };
      if (idx.nome < 0 || idx.numero < 0) { toast.error("Faltam colunas 'nome' e 'numero'."); return; }
      const out: ImportRow[] = [];
      const seenNumbers = new Set<string>();
      for (let i = 1; i < parsed.length; i++) {
        const r = parsed[i];
        const nome = (r[idx.nome] ?? "").trim();
        const numero = (r[idx.numero] ?? "").trim();
        if (!nome || !numero) continue;
        const normalized = normalizePhone(numero);
        const isDup = existingNumbers.has(normalized) || seenNumbers.has(normalized);
        seenNumbers.add(normalized);
        out.push({
          nome,
          numero,
          valor_ticket: Number((r[idx.valor_ticket] ?? "").toString().replace(",", ".")) || 0,
          data_primeira_call: idx.data_primeira_call >= 0 ? parseBrDate(r[idx.data_primeira_call] ?? "") : null,
          sinal_dado: idx.sinal_dado >= 0 ? (Number((r[idx.sinal_dado] ?? "").toString().replace(",", ".")) || 0) : 0,
          observacoes: idx.observacoes >= 0 ? ((r[idx.observacoes] ?? "").trim() || null) : null,
          origem: idx.origem >= 0 ? ((r[idx.origem] ?? "").trim() || null) : null,
          duplicated: isDup,
        });
      }
      setRows(out);
    };
    reader.readAsText(f, "utf-8");
  }

  const dupCount = rows.filter((r) => r.duplicated).length;

  const confirmImport = useMutation({
    mutationFn: async () => {
      const toInsert = rows.filter((r) => !(skipDup && r.duplicated)).map((r) => ({
        nome: r.nome,
        numero: r.numero,
        valor_ticket: r.valor_ticket,
        data_primeira_call: r.data_primeira_call,
        sinal_dado: r.sinal_dado,
        observacoes: r.observacoes,
        origem: r.origem,
      }));
      if (toInsert.length === 0) throw new Error("Nada para importar.");
      // Inserir em lotes de 500
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500);
        const { error } = await supabase.from("recovery_leads").insert(batch as any);
        if (error) throw error;
      }
      return toInsert.length;
    },
    onSuccess: (n) => { toast.success(`${n} lead(s) importado(s).`); qc.invalidateQueries({ queryKey: ["recovery_leads"] }); onClose(); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="eda-card w-full max-w-3xl max-h-[90vh] overflow-y-auto" style={{ padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Importar CSV — Recuperação de Leads</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text2)" }}>
          Colunas esperadas: <code>nome, numero, valor_ticket, data_primeira_call, sinal_dado, observacoes</code> (opcional: <code>origem</code>). Datas em <code>dd/mm/yyyy</code>.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files && e.target.files[0] && handleFile(e.target.files[0])}
          className="mb-4"
        />
        {rows.length > 0 && (
          <>
            <div className="text-sm mb-3">
              <span className="font-semibold">{rows.length}</span> linhas encontradas
              {dupCount > 0 && <span className="ml-2" style={{ color: "var(--red)" }}>· {dupCount} número(s) duplicado(s)</span>}
              {fileName && <span className="ml-2" style={{ color: "var(--text3)" }}>· {fileName}</span>}
            </div>
            {dupCount > 0 && (
              <label className="flex items-center gap-2 text-xs mb-3">
                <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />
                Ignorar duplicados na importação
              </label>
            )}
            <div className="overflow-x-auto max-h-[40vh] border rounded-lg" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-xs">
                <thead style={{ background: "var(--surface2)" }}>
                  <tr><th className="text-left p-2">Nome</th><th className="text-left p-2">Número</th><th className="text-left p-2">Ticket</th><th className="text-left p-2">1ª call</th><th className="text-left p-2">Sinal</th><th className="text-left p-2">Obs</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} style={{ background: r.duplicated ? "rgba(239,68,68,0.08)" : undefined, borderTop: "1px solid var(--border)" }}>
                      <td className="p-2">{r.nome}</td>
                      <td className="p-2">{r.numero}{r.duplicated && <span className="ml-1 text-[10px]" style={{ color: "var(--red)" }}>(dup)</span>}</td>
                      <td className="p-2">{eur(r.valor_ticket)}</td>
                      <td className="p-2">{r.data_primeira_call ?? "—"}</td>
                      <td className="p-2">{r.sinal_dado > 0 ? eur(r.sinal_dado) : "—"}</td>
                      <td className="p-2">{r.observacoes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && <div className="text-center text-xs p-2" style={{ color: "var(--text3)" }}>… + {rows.length - 200} linhas</div>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="eda-btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="eda-btn" disabled={confirmImport.isPending} onClick={() => confirmImport.mutate()}>Confirmar importação</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
