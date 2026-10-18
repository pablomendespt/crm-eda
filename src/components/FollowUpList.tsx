import { useState } from "react";
import { friendlyError } from "@/lib/rls-error";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  updateFollowUp,
  deleteFollowUp,
  isOverdue,
  TIPO_LABEL,
  STATUS_LABEL,
  STATUS_COLOR,
  PRIO_LABEL,
  PRIO_COLOR,
  type FollowUp,
  type FollowUpStatus,
} from "@/lib/followups";
import { FollowUpForm } from "@/components/FollowUpForm";
import { CalendarClock, AlertTriangle, Trash2, CheckCircle2 } from "lucide-react";

function fmt(dt: string) {
  return new Date(dt).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
}

type Props = {
  items: FollowUp[];
  showLead?: boolean;
  leadNames?: Record<string, string>;
  memberNames?: Record<string, string>;
  canDelete?: boolean;
};

export function FollowUpList({ items, showLead, leadNames, memberNames, canDelete }: Props) {
  const qc = useQueryClient();
  const [reschedFor, setReschedFor] = useState<FollowUp | null>(null);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: FollowUpStatus }) => {
      await updateFollowUp(id, { status });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["follow_ups"] });
      if (vars.status === "concluido") {
        const fu = items.find((i) => i.id === vars.id);
        if (fu) setReschedFor(fu);
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => deleteFollowUp(id),
    onSuccess: () => { toast.success("Removido."); qc.invalidateQueries({ queryKey: ["follow_ups"] }); },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (items.length === 0) {
    return <div className="text-sm text-center py-6" style={{ color: "var(--text3)" }}>Sem follow-ups.</div>;
  }

  return (
    <>
      <div className="space-y-2">
        {items.map((fu) => {
          const overdue = isOverdue(fu);
          return (
            <div
              key={fu.id}
              className="p-3 rounded-lg"
              style={{
                background: "var(--surface2)",
                border: `1px solid ${overdue ? "var(--red)" : "var(--border)"}`,
                boxShadow: overdue ? "0 0 0 1px rgba(239,68,68,0.25)" : undefined,
              }}
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "var(--surface3)", color: "var(--text)" }}>
                      {TIPO_LABEL[fu.tipo]}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "var(--surface3)", color: PRIO_COLOR[fu.prioridade] }}>
                      {PRIO_LABEL[fu.prioridade]}
                    </span>
                    {overdue && (
                      <span className="text-[10px] font-bold uppercase flex items-center gap-1" style={{ color: "var(--red)" }}>
                        <AlertTriangle size={11} /> Atrasado
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-sm font-medium">
                    {showLead && leadNames?.[fu.lead_id] && (
                      <span style={{ color: "var(--accent)" }}>{leadNames[fu.lead_id]} · </span>
                    )}
                    <span className="inline-flex items-center gap-1" style={{ color: "var(--text2)" }}>
                      <CalendarClock size={12} /> {fmt(fu.scheduled_at)}
                    </span>
                  </div>
                  {memberNames?.[fu.responsavel_id] && (
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text3)" }}>
                      Responsável: {memberNames[fu.responsavel_id]}
                    </div>
                  )}
                  {fu.proximo_passo && <div className="text-xs mt-1" style={{ color: "var(--text2)" }}>→ {fu.proximo_passo}</div>}
                  {fu.resultado && <div className="text-xs mt-1 italic" style={{ color: "var(--text3)" }}>“{fu.resultado}”</div>}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="eda-input text-xs"
                    style={{ minWidth: 130, color: STATUS_COLOR[fu.status] }}
                    value={fu.status}
                    onChange={(e) => setStatus.mutate({ id: fu.id, status: e.target.value as FollowUpStatus })}
                  >
                    {(Object.keys(STATUS_LABEL) as FollowUpStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  {fu.status !== "concluido" && (
                    <button
                      type="button"
                      title="Marcar como concluído"
                      onClick={() => setStatus.mutate({ id: fu.id, status: "concluido" })}
                      style={{ color: "var(--green)" }}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      title="Remover"
                      onClick={() => { if (confirm("Remover follow-up?")) del.mutate(fu.id); }}
                      style={{ color: "var(--red)" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {reschedFor && (
        <FollowUpForm
          leadId={reschedFor.lead_id}
          defaultResponsavelId={reschedFor.responsavel_id}
          onClose={() => setReschedFor(null)}
        />
      )}
    </>
  );
}
