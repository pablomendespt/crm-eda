import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/rls-error";
import { useProfile } from "@/hooks/useAuth";
import {
  LEAD_ESTADOS, LEAD_PRODUTOS, LEAD_ORIGENS, PRIO_LABEL, leadEstadoInfo,
  type FollowUpLead, type FollowUpPrioridade,
} from "@/lib/followups";

type Member = { id: string; nome: string; role: string; ativo: boolean };

function toLocalInput(s: string | null) {
  if (!s) return "";
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function LeadFollowUpForm({ lead, members, onClose }: { lead?: FollowUpLead | null; members: Member[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: prof } = useProfile();
  const myId = prof?.profile?.member_id ?? null;
  const myRole = prof?.role ?? null;
  const editing = !!lead;

  const closers = members.filter((m) => m.ativo && (m.role === "closer" || m.role === "cs"));
  const sdrs = members.filter((m) => m.ativo && m.role === "sdr");

  const [f, setF] = useState({
    nome: lead?.nome ?? "",
    tel: lead?.tel ?? "",
    email: lead?.email ?? "",
    produto: lead?.produto ?? "",
    ticket: lead?.ticket ? String(lead.ticket) : "",
    closer_id: lead?.closer_id ?? (myRole === "closer" ? myId ?? "" : ""),
    sdr_id: lead?.sdr_id ?? (myRole === "sdr" ? myId ?? "" : ""),
    origem: lead?.origem ?? "",
    call_1_at: toLocalInput(lead?.call_1_at ?? lead?.data_1call ?? null),
    data_prevista_fecho: lead?.data_prevista_fecho ?? "",
    fu_estado: lead?.fu_estado ?? "em_followup",
    prioridade: lead?.prioridade ?? "media",
    qtd_followups: String(lead?.qtd_followups ?? 0),
    qtd_ligacoes: String(lead?.qtd_ligacoes ?? 0),
    deu_sinal: lead?.deu_sinal ?? false,
    sinal: lead?.sinal ? String(lead.sinal) : "",
    link_call: lead?.link_call ?? "",
    notas: lead?.notas ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const num = (s: string) => Number(String(s).replace(",", ".")) || 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!f.nome.trim()) throw new Error("O nome do lead é obrigatório.");
      if (f.origem === "sdr" && !f.sdr_id) throw new Error("Com origem «Agendamento via SDR», escolhe o SDR que agendou.");
      const callAt = f.call_1_at ? new Date(f.call_1_at) : null;
      const payload: Record<string, unknown> = {
        nome: f.nome.trim(),
        tel: f.tel.trim() || null,
        email: f.email.trim() || null,
        produto: f.produto || null,
        ticket: num(f.ticket),
        closer_id: f.closer_id || null,
        sdr_id: f.sdr_id || null,
        origem: f.origem || null,
        call_1_at: callAt ? callAt.toISOString() : null,
        data_1call: f.call_1_at ? f.call_1_at.slice(0, 10) : null,
        data_prevista_fecho: f.data_prevista_fecho || null,
        fu_estado: f.fu_estado,
        prioridade: f.prioridade,
        qtd_followups: Math.max(0, Math.round(num(f.qtd_followups))),
        qtd_ligacoes: Math.max(0, Math.round(num(f.qtd_ligacoes))),
        deu_sinal: f.deu_sinal,
        sinal: f.deu_sinal ? num(f.sinal) : 0,
        link_call: f.link_call.trim() || null,
        notas: f.notas.trim() || null,
      };
      if (editing) {
        const { data, error } = await (supabase as any).from("leads").update(payload).eq("id", lead!.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Sem permissão para alterar este lead.");
      } else {
        const { error } = await (supabase as any).from("leads").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Alterações guardadas." : "Lead criado.");
      qc.invalidateQueries({ queryKey: ["leads-followups"] });
      onClose();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const curEstado = LEAD_ESTADOS.some((e) => e.key === f.fu_estado) ? null : leadEstadoInfo(f.fu_estado);

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <form className="eda-card w-full max-w-3xl my-6" style={{ padding: 28 }}
        onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">{editing ? "Editar lead" : "Novo follow-up"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="w-9 h-9 rounded-md" style={{ color: "var(--text3)" }}>✕</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
          <F label="Nome" full><input className="eda-input w-full" value={f.nome} onChange={(e) => set("nome", e.target.value)} required /></F>
          <F label="Número"><input className="eda-input w-full" value={f.tel} onChange={(e) => set("tel", e.target.value)} placeholder="+351..." /></F>
          <F label="E-mail"><input type="email" className="eda-input w-full" value={f.email} onChange={(e) => set("email", e.target.value)} /></F>

          <F label="Produto oferecido">
            <select className="eda-input w-full" value={f.produto} onChange={(e) => set("produto", e.target.value)}>
              <option value="">— escolher —</option>
              {LEAD_PRODUTOS.map((p) => <option key={p} value={p}>{p}</option>)}
              {f.produto && !(LEAD_PRODUTOS as readonly string[]).includes(f.produto) && <option value={f.produto}>{f.produto}</option>}
            </select>
          </F>
          <F label="Valor oferecido (€)"><input className="eda-input w-full" inputMode="decimal" value={f.ticket} onChange={(e) => set("ticket", e.target.value)} placeholder="697,00" /></F>

          <F label="Closer responsável">
            <select className="eda-input w-full" value={f.closer_id} onChange={(e) => set("closer_id", e.target.value)}>
              <option value="">— sem Closer —</option>
              {closers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </F>
          <F label="Origem do lead">
            <select className="eda-input w-full" value={f.origem} onChange={(e) => set("origem", e.target.value)}>
              <option value="">— escolher —</option>
              {LEAD_ORIGENS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </F>
          <F label={f.origem === "sdr" ? "SDR que agendou *" : "SDR que agendou"}>
            <select className="eda-input w-full" value={f.sdr_id} onChange={(e) => set("sdr_id", e.target.value)} required={f.origem === "sdr"}>
              <option value="">— sem SDR —</option>
              {sdrs.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </F>
          <div className="hidden md:block" />

          <F label="Data e hora da 1ª call"><input type="datetime-local" className="eda-input w-full" value={f.call_1_at} onChange={(e) => set("call_1_at", e.target.value)} /></F>
          <F label="Previsão de fecho"><input type="date" className="eda-input w-full" value={f.data_prevista_fecho} onChange={(e) => set("data_prevista_fecho", e.target.value)} /></F>

          <F label="Estado do lead">
            <select className="eda-input w-full" value={f.fu_estado} onChange={(e) => set("fu_estado", e.target.value)}>
              {curEstado && <option value={f.fu_estado}>{curEstado.label}</option>}
              {LEAD_ESTADOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </F>
          <F label="Prioridade">
            <select className="eda-input w-full" value={f.prioridade} onChange={(e) => set("prioridade", e.target.value)}>
              {(["baixa", "media", "alta"] as FollowUpPrioridade[]).map((p) => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
            </select>
          </F>
          <F label="Qtd. follow-ups"><input className="eda-input w-full" inputMode="numeric" value={f.qtd_followups} onChange={(e) => set("qtd_followups", e.target.value.replace(/\D/g, ""))} /></F>
          <F label="Qtd. ligações"><input className="eda-input w-full" inputMode="numeric" value={f.qtd_ligacoes} onChange={(e) => set("qtd_ligacoes", e.target.value.replace(/\D/g, ""))} /></F>

          <F label="Deu sinal?">
            <select className="eda-input w-full" value={f.deu_sinal ? "sim" : "nao"} onChange={(e) => set("deu_sinal", e.target.value === "sim")}>
              <option value="nao">Não</option><option value="sim">Sim</option>
            </select>
          </F>
          <F label="Valor do sinal (€)"><input className="eda-input w-full" inputMode="decimal" value={f.sinal} disabled={!f.deu_sinal} onChange={(e) => set("sinal", e.target.value)} placeholder="0" /></F>

          <F label="Link da 1ª call" full><input type="url" className="eda-input w-full" value={f.link_call} onChange={(e) => set("link_call", e.target.value)} placeholder="https://..." /></F>
          <F label="Observações" full><textarea className="eda-input w-full" rows={3} value={f.notas} onChange={(e) => set("notas", e.target.value)} /></F>
        </div>

        <div className="flex gap-3 justify-end pt-6">
          <button type="button" onClick={onClose} className="eda-btn-ghost">Cancelar</button>
          <button type="submit" className="eda-btn" disabled={save.isPending}>
            {save.isPending ? "A guardar..." : editing ? "Guardar alterações" : "Criar lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : undefined}>
      <label className="block text-[11px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text3)" }}>{label}</label>
      {children}
    </div>
  );
}
