import { useState, useEffect } from "react";
import { friendlyError } from "@/lib/rls-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createFollowUp,
  type FollowUpTipo,
  type FollowUpPrioridade,
  TIPO_LABEL,
  PRIO_LABEL,
} from "@/lib/followups";
import { useProfile } from "@/hooks/useAuth";

type Props = {
  leadId?: string;
  defaultResponsavelId?: string;
  onClose: () => void;
  onCreated?: () => void;
  prefill?: {
    nome?: string;
    tel?: string;
    email?: string;
    produto?: string;
    valor?: string | number;
    tipo?: FollowUpTipo;
    proximoPasso?: string;
    scheduledAt?: Date;
  };
};

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FollowUpForm({ leadId, defaultResponsavelId, onClose, onCreated, prefill }: Props) {
  const qc = useQueryClient();
  const { data: prof } = useProfile();
  const myMemberId = prof?.profile?.member_id ?? null;
  const myRole = prof?.role ?? null;

  const [mode, setMode] = useState<"existing" | "new">(leadId ? "existing" : "new");
  const [selectedLead, setSelectedLead] = useState<string>(leadId ?? "");
  const [newNome, setNewNome] = useState(prefill?.nome ?? "");
  const [newTel, setNewTel] = useState(prefill?.tel ?? "");
  const [newEmail, setNewEmail] = useState(prefill?.email ?? "");
  const [newProduto, setNewProduto] = useState(prefill?.produto ?? "");
  const [newValor, setNewValor] = useState(prefill?.valor != null ? String(prefill.valor) : "");

  const [responsavel, setResponsavel] = useState<string>(defaultResponsavelId ?? myMemberId ?? "");
  const [tipo, setTipo] = useState<FollowUpTipo>(prefill?.tipo ?? "whatsapp");
  const [prioridade, setPrioridade] = useState<FollowUpPrioridade>("media");
  const tomorrow = prefill?.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInput(tomorrow));
  const [proximoPasso, setProximoPasso] = useState<string>(prefill?.proximoPasso ?? "");
  const [resultado, setResultado] = useState<string>("");

  useEffect(() => {
    if (!responsavel && myMemberId) setResponsavel(myMemberId);
  }, [myMemberId, responsavel]);

  const { data: leads } = useQuery({
    queryKey: ["leads-mini"],
    enabled: !leadId,
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, nome").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: members } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return (data ?? []) as { id: string; nome: string; role: string; ativo: boolean }[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!responsavel) throw new Error("Selecione um responsável");
      let leadIdToUse = selectedLead;
      if (mode === "new") {
        if (!newNome.trim()) throw new Error("Nome do lead é obrigatório");
        const { data: ins, error: eIns } = await supabase
          .from("leads")
          .insert({
            nome: newNome.trim(),
            tel: newTel || null,
            email: newEmail || null,
            notas: newProduto ? `Produto/valor oferecido: ${newProduto}${newValor ? ` — ${newValor}€` : ""}` : null,
            ticket: Number(newValor) || 0,
            sdr_id: myRole === "sdr" ? myMemberId : null,
            closer_id: myRole === "closer" ? myMemberId : null,
          } as any)
          .select("id")
          .single();
        if (eIns) throw eIns;
        leadIdToUse = ins.id;
      }
      if (!leadIdToUse) throw new Error("Selecione um lead");
      await createFollowUp({
        lead_id: leadIdToUse,
        responsavel_id: responsavel,
        tipo,
        prioridade,
        scheduled_at: new Date(scheduledAt).toISOString(),
        proximo_passo: proximoPasso || null,
        resultado: resultado || null,
      });
    },
    onSuccess: () => {
      toast.success("Follow-up agendado.");
      qc.invalidateQueries({ queryKey: ["follow_ups"] });
      qc.invalidateQueries({ queryKey: ["leads-mini"] });
      qc.invalidateQueries({ queryKey: ["leads-names"] });
      onCreated?.();
      onClose();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <form
        className="eda-card w-full max-w-lg space-y-3"
        style={{ padding: 24 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">Novo Follow-up</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: "var(--text3)" }}>✕</button>
        </div>

        {!leadId && (
          <>
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
              <button type="button" onClick={() => setMode("new")} className="flex-1 text-xs py-1.5 rounded"
                style={{ background: mode === "new" ? "var(--accent)" : "transparent", color: mode === "new" ? "#fff" : "var(--text2)", fontWeight: 600 }}>
                Novo lead
              </button>
              <button type="button" onClick={() => setMode("existing")} className="flex-1 text-xs py-1.5 rounded"
                style={{ background: mode === "existing" ? "var(--accent)" : "transparent", color: mode === "existing" ? "#fff" : "var(--text2)", fontWeight: 600 }}>
                Lead existente
              </button>
            </div>

            {mode === "existing" ? (
              <div>
                <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Lead</label>
                <select className="eda-input w-full" value={selectedLead} onChange={(e) => setSelectedLead(e.target.value)} required>
                  <option value="">— escolher —</option>
                  {leads?.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Nome</label>
                  <input className="eda-input w-full" value={newNome} onChange={(e) => setNewNome(e.target.value)} required />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Número</label>
                  <input className="eda-input w-full" value={newTel} onChange={(e) => setNewTel(e.target.value)} placeholder="+351..." />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Email</label>
                  <input type="email" className="eda-input w-full" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Produto oferecido</label>
                  <input className="eda-input w-full" value={newProduto} onChange={(e) => setNewProduto(e.target.value)} placeholder="Ex.: Mentoria Pro" />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Valor oferecido (EUR)</label>
                  <input type="number" step="0.01" className="eda-input w-full" value={newValor} onChange={(e) => setNewValor(e.target.value)} />
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Responsável</label>
            <select className="eda-input w-full" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} required>
              <option value="">—</option>
              {members?.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.role})</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Tipo</label>
            <select className="eda-input w-full" value={tipo} onChange={(e) => setTipo(e.target.value as FollowUpTipo)}>
              {(Object.keys(TIPO_LABEL) as FollowUpTipo[]).map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Data e hora</label>
            <input type="datetime-local" className="eda-input w-full" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Prioridade</label>
            <select className="eda-input w-full" value={prioridade} onChange={(e) => setPrioridade(e.target.value as FollowUpPrioridade)}>
              {(Object.keys(PRIO_LABEL) as FollowUpPrioridade[]).map((p) => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Próximo passo</label>
          <input className="eda-input w-full" value={proximoPasso} onChange={(e) => setProximoPasso(e.target.value)} placeholder="Ex.: Enviar proposta" />
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>Observação</label>
          <textarea className="eda-input w-full" rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="eda-btn-ghost">Cancelar</button>
          <button type="submit" className="eda-btn" disabled={create.isPending}>Agendar</button>
        </div>
      </form>
    </div>
  );
}
