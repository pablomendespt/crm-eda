import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { todayISO } from "@/lib/format";
import { NumInput } from "@/components/NumInput";
import { toast } from "sonner";


// Nota: campos de "valor de venda" foram removidos. O SDR nunca digita valor;
// o valor da venda é definido em "Registar Venda" pelo Closer/Fundador.
type SdrDailyRow = {
  id?: string;
  member_id: string;
  data: string;
  conversas_iniciadas: number;
  conversas_leandro: number;
  conversas_pablo: number;
  respostas_1a: number;
  respostas_leandro: number;
  respostas_pablo: number;
  ligacoes_feitas: number;
  ligacoes_atendidas: number;
  followups_feitos: number;
  agendamentos_ligacao: number;
  leads_qualificados: number;
  observacoes: string | null;
};

const EMPTY = (member_id: string, data: string): SdrDailyRow => ({
  member_id,
  data,
  conversas_iniciadas: 0,
  conversas_leandro: 0,
  conversas_pablo: 0,
  respostas_1a: 0,
  respostas_leandro: 0,
  respostas_pablo: 0,
  ligacoes_feitas: 0,
  ligacoes_atendidas: 0,
  followups_feitos: 0,
  agendamentos_ligacao: 0,
  leads_qualificados: 0,
  observacoes: "",
});

export function RegistrarDia() {
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const memberId = profile?.profile?.member_id as string | undefined;
  const [data, setData] = useState<string>(todayISO());
  const [form, setForm] = useState<SdrDailyRow | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["sdr_daily", memberId, data],
    enabled: !!memberId,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("sdr_daily")
        .select("*")
        .eq("member_id", memberId)
        .eq("data", data)
        .maybeSingle();
      if (error) throw error;
      return rows as SdrDailyRow | null;
    },
  });

  useEffect(() => {
    if (!memberId) return;
    setForm(existing ?? EMPTY(memberId, data));
  }, [existing, memberId, data]);

  if (!memberId) {
    return (
      <div className="eda-card">
        <p className="text-sm" style={{ color: "var(--text2)" }}>
          O teu utilizador não está ligado a um membro. Pede a um sócio para associar.
        </p>
      </div>
    );
  }
  if (isLoading || !form) return <div className="text-sm">A carregar...</div>;

  const set = <K extends keyof SdrDailyRow>(k: K, v: SdrDailyRow[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form) return;
    setSaving(true);
    // Só enviamos as colunas de atividade. Valores em euro nunca são gravados aqui.
    const payload = {
      member_id: form.member_id,
      data: form.data,
      conversas_iniciadas: form.conversas_iniciadas,
      conversas_leandro: form.conversas_leandro,
      conversas_pablo: form.conversas_pablo,
      respostas_1a: form.respostas_1a,
      respostas_leandro: form.respostas_leandro,
      respostas_pablo: form.respostas_pablo,
      ligacoes_feitas: form.ligacoes_feitas,
      ligacoes_atendidas: form.ligacoes_atendidas,
      followups_feitos: form.followups_feitos,
      agendamentos_ligacao: form.agendamentos_ligacao ?? 0,
      leads_qualificados: form.leads_qualificados,
      observacoes: form.observacoes,
    };
    const { error } = await (supabase as any)
      .from("sdr_daily")
      .upsert(payload, { onConflict: "member_id,data" });
    setSaving(false);
    if (error) {
      toast.error("Erro ao guardar", { description: error.message });
      return;
    }
    toast.success("Dia guardado");
    qc.invalidateQueries({ queryKey: ["sdr_daily"] });
  }

  async function remove() {
    if (!memberId) return;
    if (!existing?.id) {
      setForm(EMPTY(memberId, data));
      toast.success("Formulário limpo");
      return;
    }
    if (!confirm(`Tens a certeza que queres apagar o registo do dia ${data}? Esta ação não pode ser desfeita.`)) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("sdr_daily")
      .delete()
      .eq("member_id", memberId)
      .eq("data", data);
    setSaving(false);
    if (error) {
      toast.error("Erro ao apagar", { description: error.message });
      return;
    }
    toast.success("Registo apagado");
    setForm(EMPTY(memberId, data));
    qc.invalidateQueries({ queryKey: ["sdr_daily"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Atividade SDR</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
            Só atividade: quantos contactos, respostas, ligações e reuniões marcadas. Valor de venda é registado pelo Closer.
          </p>
        </div>
        <div>
          <label className="block text-xs uppercase font-semibold mb-1" style={{ color: "var(--text3)" }}>Data</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="eda-input"
          />
        </div>
      </div>

      <Section
        title="Conversas iniciadas"
        onReset={() => setForm((f) => f && { ...f, conversas_iniciadas: 0, conversas_leandro: 0, conversas_pablo: 0 })}
      >
        <Num label="Total no dia" value={form.conversas_iniciadas} onChange={(v) => set("conversas_iniciadas", v)} />
        <Num label="@leandrosantanapt" value={form.conversas_leandro} onChange={(v) => set("conversas_leandro", v)} />
        <Num label="@pablomendespt" value={form.conversas_pablo} onChange={(v) => set("conversas_pablo", v)} />
      </Section>

      <Section
        title="Respostas à 1ª mensagem"
        onReset={() => setForm((f) => f && { ...f, respostas_1a: 0, respostas_leandro: 0, respostas_pablo: 0 })}
      >
        <Num label="Total no dia" value={form.respostas_1a} onChange={(v) => set("respostas_1a", v)} />
        <Num label="@leandrosantanapt" value={form.respostas_leandro} onChange={(v) => set("respostas_leandro", v)} />
        <Num label="@pablomendespt" value={form.respostas_pablo} onChange={(v) => set("respostas_pablo", v)} />
      </Section>

      <Section
        title="Ligações"
        onReset={() => setForm((f) => f && { ...f, ligacoes_feitas: 0, ligacoes_atendidas: 0, agendamentos_ligacao: 0 })}
      >
        <Num label="Feitas" value={form.ligacoes_feitas} onChange={(v) => set("ligacoes_feitas", v)} />
        <Num label="Atendidas" value={form.ligacoes_atendidas} onChange={(v) => set("ligacoes_atendidas", v)} />
        <Num label="Agendamentos por ligação" value={form.agendamentos_ligacao} onChange={(v) => set("agendamentos_ligacao", v)} />
      </Section>

      <Section
        title="Follow-ups e qualificação"
        onReset={() =>
          setForm(
            (f) =>
              f && {
                ...f,
                followups_feitos: 0,
                leads_qualificados: 0,
              },
          )
        }
      >
        <Num label="Follow-ups feitos" value={form.followups_feitos} onChange={(v) => set("followups_feitos", v)} />
        <Num label="Leads qualificados" value={form.leads_qualificados} onChange={(v) => set("leads_qualificados", v)} />
      </Section>

      <div className="eda-card">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs uppercase font-semibold" style={{ color: "var(--text3)" }}>Observações</label>
          <button type="button" onClick={() => set("observacoes", "")} className="text-[11px]" style={{ color: "var(--text3)" }}>
            Limpar
          </button>
        </div>
        <textarea
          value={form.observacoes ?? ""}
          onChange={(e) => set("observacoes", e.target.value)}
          rows={3}
          className="eda-input w-full"
          placeholder="Ex.: muitos leads reclamaram do preço, Instagram caiu, campanha X trouxe leads melhores."
        />
      </div>

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <button onClick={remove} disabled={saving} className="eda-btn-ghost" style={{ color: "var(--danger, #dc2626)" }}>
          {existing?.id ? "Apagar registo deste dia" : "Limpar formulário"}
        </button>
        <button onClick={save} disabled={saving} className="eda-btn">
          {saving ? "A guardar..." : "Guardar dia"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, onReset, children }: { title: string; onReset?: () => void; children: React.ReactNode }) {
  return (
    <div className="eda-card">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase font-semibold" style={{ color: "var(--text2)" }}>{title}</div>
        {onReset && (
          <button type="button" onClick={onReset} className="text-[11px]" style={{ color: "var(--text3)" }}>
            Zerar
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

function Num({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <div>
      <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>{label}</label>
      <NumInput value={value} onChange={onChange} step={step ?? "1"} />
    </div>
  );
}
