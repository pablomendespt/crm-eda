import { supabase } from "@/integrations/supabase/client";

export type FollowUpTipo = "ligacao" | "whatsapp" | "mensagem" | "reuniao" | "email";
export type FollowUpStatus = "pendente" | "concluido" | "remarcado" | "cancelado" | "sem_resposta";
export type FollowUpPrioridade = "alta" | "media" | "baixa";

export type FollowUp = {
  id: string;
  lead_id: string;
  responsavel_id: string;
  tipo: FollowUpTipo;
  status: FollowUpStatus;
  prioridade: FollowUpPrioridade;
  scheduled_at: string;
  resultado: string | null;
  proximo_passo: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FollowUpInsert = {
  lead_id: string;
  responsavel_id: string;
  tipo: FollowUpTipo;
  scheduled_at: string;
  prioridade?: FollowUpPrioridade;
  status?: FollowUpStatus;
  resultado?: string | null;
  proximo_passo?: string | null;
};

export const TIPO_LABEL: Record<FollowUpTipo, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  mensagem: "Mensagem",
  reuniao: "Reunião",
  email: "E-mail",
};

export const STATUS_LABEL: Record<FollowUpStatus, string> = {
  pendente: "Pendente",
  concluido: "Concluído",
  remarcado: "Remarcado",
  cancelado: "Cancelado",
  sem_resposta: "Sem resposta",
};

export const PRIO_LABEL: Record<FollowUpPrioridade, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const PRIO_COLOR: Record<FollowUpPrioridade, string> = {
  alta: "var(--red)",
  media: "var(--gold)",
  baixa: "var(--text2)",
};

export const STATUS_COLOR: Record<FollowUpStatus, string> = {
  pendente: "var(--accent)",
  concluido: "var(--green)",
  remarcado: "var(--gold)",
  cancelado: "var(--text3)",
  sem_resposta: "var(--red)",
};

export function isOverdue(fu: Pick<FollowUp, "scheduled_at" | "status">) {
  return fu.status === "pendente" && new Date(fu.scheduled_at).getTime() < Date.now();
}

export async function listFollowUps(opts: { leadId?: string } = {}): Promise<FollowUp[]> {
  let q = supabase.from("follow_ups").select("*").order("scheduled_at", { ascending: true });
  if (opts.leadId) q = q.eq("lead_id", opts.leadId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FollowUp[];
}

export async function createFollowUp(payload: FollowUpInsert) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("follow_ups")
    .insert({ ...payload, created_by: u.user?.id ?? null });
  if (error) throw error;
}

export async function updateFollowUp(id: string, patch: Partial<FollowUp>) {
  const { error } = await supabase.from("follow_ups").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteFollowUp(id: string) {
  const { error } = await supabase.from("follow_ups").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Estado do lead (tabela de Follow-ups: 1 linha por lead) ----------
export const LEAD_ESTADOS = [
  { key: "em_followup", label: "Em processo de follow-up", color: "var(--accent)" },
  { key: "potencial", label: "Potencial de compra", color: "var(--accent-bright)" },
  { key: "segunda_call", label: "Remarcado / 2ª Call", color: "var(--accent-bright)" },
  { key: "pendente_sinal", label: "Pendente sinal", color: "var(--gold)" },
  { key: "deu_sinal_sem_assinar", label: "Deu sinal, mas ainda não assinou", color: "var(--gold)" },
  { key: "deu_sinal_assinou", label: "Deu sinal e assinou contrato de compromisso", color: "var(--green)" },
  { key: "pendente_dados", label: "Pendente dados para contrato", color: "var(--gold)" },
  { key: "aguardando_pagamento", label: "Aguardando pagamento", color: "var(--green)" },
  { key: "comprou", label: "Comprou", color: "var(--green)" },
  { key: "reembolso", label: "Pediu reembolso", color: "var(--red)" },
  { key: "perdido", label: "Perdido", color: "var(--red)" },
] as const;
export type LeadEstado = (typeof LEAD_ESTADOS)[number]["key"];
export const LEAD_ESTADO_FECHADOS: string[] = ["comprou", "reembolso", "perdido"];
// Estados retirados da lista, mantidos só para mostrar dados antigos.
const LEAD_ESTADOS_LEGADO: Record<string, { label: string; color: string }> = {
  sem_resposta: { label: "Sem resposta", color: "var(--text3)" },
};
export function leadEstadoInfo(key: string): { label: string; color: string } {
  const e = LEAD_ESTADOS.find((x) => x.key === key);
  return e ?? LEAD_ESTADOS_LEGADO[key] ?? { label: key, color: "var(--text2)" };
}

// Listas pré-definidas — acrescentar aqui novos produtos/origens.
export const LEAD_PRODUTOS = ["EDA", "PVE", "Evento 100K"] as const;
export const LEAD_ORIGENS = [
  { key: "sdr", label: "Agendamento via SDR" },
  { key: "indicacao", label: "Indicação" },
  { key: "outro", label: "Outro" },
] as const;
export function origemLabel(k: string | null | undefined) {
  return LEAD_ORIGENS.find((o) => o.key === k)?.label ?? "—";
}

export type FollowUpLead = {
  id: string; nome: string; tel: string | null; email: string | null;
  sdr_id: string | null; closer_id: string | null; data_1call: string | null; call_1_at: string | null;
  ticket: number | null; sinal: number | null; deu_sinal: boolean; notas: string | null;
  fu_estado: string; qtd_followups: number; qtd_ligacoes: number;
  data_prevista_fecho: string | null; link_call: string | null; created_at: string;
  produto: string | null; origem: string | null; prioridade: string;
};
export const FOLLOWUP_LEAD_COLS =
  "id, nome, tel, email, sdr_id, closer_id, data_1call, call_1_at, ticket, sinal, deu_sinal, notas, fu_estado, qtd_followups, qtd_ligacoes, data_prevista_fecho, link_call, created_at, produto, origem, prioridade";
