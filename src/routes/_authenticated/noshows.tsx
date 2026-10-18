import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { NumInput } from "@/components/NumInput";
import { useMembrosDir } from "@/lib/membros";
import { useProfile, type AppRole } from "@/hooks/useAuth";


export const Route = createFileRoute("/_authenticated/noshows")({
  component: NoShows,
});

const STATUS = [
  { key: "nao_contatado", label: "Não contactado", color: "var(--red)" },
  { key: "tentando", label: "Mensagem enviada", color: "var(--gold)" },
  { key: "reagendado", label: "Reagendado", color: "var(--accent)" },
  { key: "recuperado", label: "Recuperado", color: "var(--green)" },
  { key: "perdido", label: "Lead perdido", color: "var(--text3)" },
];

type NoShowStatus = "nao_contatado" | "tentando" | "reagendado" | "recuperado" | "perdido";

function NoShows() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const myMemberId = profile?.profile?.member_id as string | undefined;
  const role = profile?.role;
  const [showForm, setShowForm] = useState(false);

  const { data } = useQuery({
    queryKey: ["noshows"],
    queryFn: async () => {
      const { data } = await supabase.from("noshows").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: NoShowStatus }) => {
      const { error } = await supabase
        .from("noshows")
        .update({ status, ultima_interacao: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["noshows"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("noshows").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Sem permissão para apagar este registo.");
    },
    onSuccess: () => {
      toast.success("Registo apagado.");
      qc.invalidateQueries({ queryKey: ["noshows"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Não Compareceu</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Clientes que faltaram à call.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="eda-btn flex items-center gap-2">
          <Plus size={14} /> Adicionar "Não Compareceu"
        </button>
      </div>

      <div className="eda-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
              <th className="py-2">Nome</th>
              <th>Contacto</th>
              <th>Produto potencial</th>
              <th>Ticket potencial</th>
              <th>Data</th>
              <th>Motivo</th>
              <th>Nº</th>
              <th>Última interação</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((n) => (
              <tr key={n.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                <td className="py-2.5 font-medium">{n.nome}</td>
                <td style={{ color: "var(--text3)" }} className="text-xs">
                  {n.email && <div>{n.email}</div>}
                  {n.tel && <div>{n.tel}</div>}
                </td>
                <td style={{ color: "var(--text2)" }}>{n.produto ?? "—"}</td>
                <td>{Number(n.ticket) > 0 ? eur(Number(n.ticket)) : "—"}</td>
                <td>{n.data ? fmtDate(n.data) : "—"}</td>
                <td style={{ color: "var(--text2)" }}>{n.motivo ?? "—"}</td>
                <td>{n.no_show_count}</td>
                <td style={{ color: "var(--text3)" }}>{n.ultima_interacao ? fmtDate(n.ultima_interacao) : "—"}</td>
                <td>
                  <select
                    className="eda-input"
                    style={{ padding: "4px 8px", width: "auto" }}
                    value={n.status}
                    onChange={(e) => updateStatus.mutate({ id: n.id, status: e.target.value as NoShowStatus })}
                  >
                    {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </td>
                <td>
                  <button
                    onClick={() => { if (confirm(`Apagar registo de "${n.nome}"?`)) remove.mutate(n.id); }}
                    disabled={remove.isPending}
                    title="Apagar"
                    className="p-1.5 rounded hover:bg-[var(--surface2)]"
                    style={{ color: "var(--red)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={10} className="py-6 text-center" style={{ color: "var(--text3)" }}>Sem registos de "Não Compareceu".</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <NoShowForm onClose={() => setShowForm(false)} myMemberId={myMemberId} role={role} />}
    </div>
  );
}

function NoShowForm({ onClose, myMemberId, role }: { onClose: () => void; myMemberId?: string; role?: AppRole }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: "",
    email: "",
    tel: "",
    data: todayISO(),
    produto: "",
    ticket: 0,
    motivo: "",
    status: "nao_contatado" as NoShowStatus,
    ultima_interacao: "",
    sdr_id: role === "sdr" ? (myMemberId ?? "") : "",
    closer_id: role === "closer" ? (myMemberId ?? "") : "",
  });

  const { closers, sdrs, ativos: membersList } = useMembrosDir();

  const create = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Nome é obrigatório");
      const payload: Record<string, unknown> = {
        nome: form.nome.trim(),
        email: form.email || null,
        tel: form.tel || null,
        data: form.data || null,
        produto: form.produto || null,
        ticket: form.ticket,
        motivo: form.motivo || null,
        status: form.status,
        sdr_id: form.sdr_id || null,
        closer_id: form.closer_id || null,
        ultima_interacao: form.ultima_interacao ? new Date(form.ultima_interacao).toISOString() : null,
      };
      const { error } = await (supabase.from("noshows") as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registo criado.");
      qc.invalidateQueries({ queryKey: ["noshows"] });
      onClose();
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="eda-card w-full max-w-lg space-y-3"
        style={{ padding: 24 }}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">Adicionar Não Compareceu</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: "var(--text3)" }}>
            <X size={16} />
          </button>
        </div>

        <Field label="Nome do lead" required>
          <input className="eda-input w-full" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input type="email" className="eda-input w-full" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Telemóvel">
            <input className="eda-input w-full" value={form.tel} onChange={(e) => setForm({ ...form, tel: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da call">
            <input type="date" className="eda-input w-full" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </Field>
          <Field label="Produto potencial">
            <input className="eda-input w-full" value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value })} placeholder="Ex.: Mentoria Pro" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ticket potencial (€)">
            <NumInput value={form.ticket} onChange={(v) => setForm({ ...form, ticket: v })} step="0.01" placeholder="0" />
          </Field>
          <Field label="Última interação">
            <input type="datetime-local" className="eda-input w-full" value={form.ultima_interacao} onChange={(e) => setForm({ ...form, ultima_interacao: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="SDR responsável">
            <select
              className="eda-input w-full"
              value={form.sdr_id}
              onChange={(e) => setForm({ ...form, sdr_id: e.target.value })}
              disabled={role === "sdr"}
            >
              <option value="">— selecionar SDR —</option>
              {sdrs.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Field>
          <Field label="Closer">
            <select
              className="eda-input w-full"
              value={form.closer_id}
              onChange={(e) => setForm({ ...form, closer_id: e.target.value })}
              disabled={role === "closer"}
            >
              <option value="">— sem closer —</option>
              {closers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Motivo (opcional)">
          <input className="eda-input w-full" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Ex.: dormiu, esqueceu, sem conexão" />
        </Field>

        <Field label="Status">
          <select className="eda-input w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as NoShowStatus })}>
            {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="eda-btn-ghost">Cancelar</button>
          <button type="submit" className="eda-btn" disabled={create.isPending}>Adicionar</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text3)" }}>{label}{required && " *"}</label>
      {children}
    </div>
  );
}
