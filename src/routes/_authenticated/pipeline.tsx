import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Plus, CalendarClock, AlertTriangle, Trash2 } from "lucide-react";
import { FollowUpForm } from "@/components/FollowUpForm";
import { FollowUpList } from "@/components/FollowUpList";
import { listFollowUps, isOverdue, type FollowUp } from "@/lib/followups";
import { useProfile } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
});

const STAGES = [
  { key: "novo", label: "Novo Lead", color: "var(--text2)" },
  { key: "qualificado", label: "Qualificado", color: "var(--accent)" },
  { key: "agendado", label: "Call Agendada", color: "var(--gold)" },
  { key: "realizado", label: "Call Feita", color: "#8b5cf6" },
  { key: "fechado", label: "Fechado", color: "var(--green)" },
] as const;

const TEMP_COLORS: Record<string, string> = {
  quente: "var(--red)",
  morno: "var(--gold)",
  frio: "var(--accent)",
};

function PipelinePage() {
  const qc = useQueryClient();
  const { data: prof } = useProfile();
  const role = prof?.role ?? "sdr";
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [canal, setCanal] = useState("Instagram");
  const [temp, setTemp] = useState<"quente" | "morno" | "frio">("morno");
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const { data: leads } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("leads").insert({ nome, canal, temp, stage: "novo" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead criado.");
      qc.invalidateQueries({ queryKey: ["leads"] });
      setNome("");
      setOpen(false);
    },
  });

  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: "novo" | "qualificado" | "agendado" | "realizado" | "fechado" }) => {
      const { error } = await supabase.from("leads").update({ stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });

  const removeLead = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("leads").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Sem permissão para apagar este lead.");
    },
    onSuccess: () => {
      toast.success("Lead apagado.");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const { data: allFus = [] } = useQuery<FollowUp[]>({
    queryKey: ["follow_ups", "pipeline"],
    queryFn: () => listFollowUps(),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return (data ?? []) as { id: string; nome: string; role: string; ativo: boolean }[];
    },
  });
  const memberNames = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.nome])), [members]);

  const fusByLead = useMemo(() => {
    const map: Record<string, FollowUp[]> = {};
    for (const f of allFus) (map[f.lead_id] ||= []).push(f);
    return map;
  }, [allFus]);

  useEffect(() => {
    const ch = supabase
      .channel("rt-pipeline-fus")
      .on("postgres_changes", { event: "*", schema: "public", table: "follow_ups" }, () => {
        qc.invalidateQueries({ queryKey: ["follow_ups"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["leads"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pipeline de Leads</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Acompanhe o funil de vendas.</p>
        </div>
        <button onClick={() => setOpen(!open)} className="eda-btn flex items-center gap-2">
          <Plus size={14} /> Novo lead
        </button>
      </div>

      {open && (
        <form
          className="eda-card grid grid-cols-1 md:grid-cols-4 gap-3"
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        >
          <input className="eda-input md:col-span-2" placeholder="Nome do lead" value={nome} onChange={(e) => setNome(e.target.value)} required />
          <select className="eda-input" value={canal} onChange={(e) => setCanal(e.target.value)}>
            <option>Instagram</option><option>WhatsApp</option><option>Indicação</option><option>Orgânico</option><option>Tráfego pago</option>
          </select>
          <select className="eda-input" value={temp} onChange={(e) => setTemp(e.target.value as "quente" | "morno" | "frio")}>
            <option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option>
          </select>
          <button className="eda-btn md:col-span-4" type="submit">Criar lead</button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {STAGES.map((s) => {
          const items = leads?.filter((l) => l.stage === s.key) ?? [];
          return (
            <div key={s.key} className="eda-card" style={{ padding: 12 }}>
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="text-[11px] font-semibold uppercase" style={{ color: s.color }}>{s.label}</div>
                <span className="text-xs" style={{ color: "var(--text3)" }}>{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((l) => {
                  const fus = fusByLead[l.id] ?? [];
                  const overdueCount = fus.filter(isOverdue).length;
                  const nextPending = fus
                    .filter((f) => f.status === "pendente")
                    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
                  return (
                  <div key={l.id} className="p-2.5 rounded-lg" style={{ background: "var(--surface2)", border: `1px solid ${overdueCount > 0 ? "var(--red)" : "var(--border)"}` }}>
                    <div className="flex items-center gap-2">
                      {l.temp && <span className="w-2 h-2 rounded-full" style={{ background: TEMP_COLORS[l.temp] }} />}
                      <div className="text-sm font-medium flex-1 truncate">{l.nome}</div>
                      {overdueCount > 0 && (
                        <span title={`${overdueCount} atrasado(s)`} style={{ color: "var(--red)" }}>
                          <AlertTriangle size={12} />
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>{l.canal ?? "—"}</div>
                    {nextPending && (
                      <div className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "var(--accent)" }}>
                        <CalendarClock size={10} /> {new Date(nextPending.scheduled_at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    )}
                    <div className="mt-2 flex gap-1 flex-wrap">
                      {STAGES.map((s2) => (
                        s2.key !== l.stage && (
                          <button
                            key={s2.key}
                            onClick={() => move.mutate({ id: l.id, stage: s2.key })}
                            title={`Mover para ${s2.label}`}
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{ background: "var(--surface3)", color: s2.color }}
                          >
                            {s2.label.split(" ")[0]}
                          </button>
                        )
                      ))}
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => setFollowUpFor(l.id)}
                        className="text-[10px] px-2 py-1 rounded flex items-center gap-1 flex-1 justify-center"
                        style={{ background: "var(--surface3)", color: "var(--accent)" }}
                      >
                        <Plus size={10} /> Follow-up
                      </button>
                      {fus.length > 0 && (
                        <button
                          onClick={() => setDetailFor(detailFor === l.id ? null : l.id)}
                          className="text-[10px] px-2 py-1 rounded"
                          style={{ background: "var(--surface3)", color: "var(--text2)" }}
                        >
                          {fus.length} {detailFor === l.id ? "▴" : "▾"}
                        </button>
                      )}
                      <button
                        onClick={() => { if (confirm(`Apagar lead "${l.nome}"? Esta ação não pode ser desfeita.`)) removeLead.mutate(l.id); }}
                        disabled={removeLead.isPending}
                        title="Apagar lead"
                        className="text-[10px] px-2 py-1 rounded"
                        style={{ background: "var(--surface3)", color: "var(--red)" }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                    {detailFor === l.id && fus.length > 0 && (
                      <div className="mt-2">
                        <FollowUpList
                          items={fus.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())}
                          memberNames={memberNames}
                          canDelete
                        />
                      </div>
                    )}
                  </div>
                  );
                })}
                {items.length === 0 && <div className="text-xs text-center py-4" style={{ color: "var(--text3)" }}>Vazio</div>}
              </div>
            </div>
          );
        })}
      </div>

      {followUpFor && <FollowUpForm leadId={followUpFor} onClose={() => setFollowUpFor(null)} />}
    </div>
  );
}
