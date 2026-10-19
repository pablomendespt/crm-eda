import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";

export type Etapa = "novo" | "conversa" | "qualificado" | "call" | "realizada" | "noshow" | "followup" | "sinal" | "venda" | "onboarding" | "aluno";

export const ETAPAS: { key: Etapa; label: string; cor: string; dica: string }[] = [
  { key: "novo", label: "Novo Lead", cor: "#64748b", dica: "Entrou agora, ainda sem contacto" },
  { key: "conversa", label: "Em conversa", cor: "#3b82f6", dica: "Já houve mensagem ou ligação" },
  { key: "qualificado", label: "Qualificado", cor: "#06b6d4", dica: "Tem perfil e interesse real" },
  { key: "call", label: "Call marcada", cor: "#8b5cf6", dica: "Está na agenda do closer" },
  { key: "realizada", label: "Call realizada", cor: "#a855f7", dica: "A call aconteceu" },
  { key: "noshow", label: "No-show / remarcar", cor: "#f97316", dica: "Não apareceu ou vai remarcar" },
  { key: "followup", label: "Follow-up", cor: "#eab308", dica: "Precisa de novo contacto" },
  { key: "sinal", label: "Sinal pago", cor: "#14b8a6", dica: "Pagou o sinal" },
  { key: "venda", label: "Venda (pago)", cor: "#22c55e", dica: "Venda fechada" },
  { key: "onboarding", label: "Onboarding", cor: "#0ea5e9", dica: "Customer Success a receber o aluno" },
  { key: "aluno", label: "Alunos", cor: "#10b981", dica: "Já é aluno" },
];
export const ETAPA_POR_KEY = Object.fromEntries(ETAPAS.map((e) => [e.key, e])) as Record<Etapa, (typeof ETAPAS)[number]>;

export type Card = {
  id: string; nome: string; tel: string | null; email: string | null; ig: string | null;
  origem: string; localidade: string | null; perfil: string | null; notas: string | null;
  sdr_id: string | null; closer_id: string | null; etapa: Etapa; etapa_em: string;
  saida: "perdido" | "desqualificado" | null; saida_motivo: string | null; saida_em: string | null;
  temperatura: "Quente" | "Morno" | "Frio" | null; objecao: string | null; proxima_em: string | null;
  sinal_valor: number | null; venda_id: string | null; pagamento: string | null; parcelas: number | null;
  ligacoes: number; mensagens: number; ultimo_contacto_em: string | null; created_at: string;
};
export type Agenda = {
  id: string; card_id: string; closer_id: string; inicio: string; fim: string;
  estado: "marcada" | "realizada" | "noshow" | "cancelada" | "remarcada"; link: string | null;
};
export type Metrica = {
  member_id: string; nome: string; role: string; dia: string; ligacoes: number; mensagens: number; contactos: number;
  novos: number; qualificados: number; marcadas: number; realizadas: number; noshows: number; followups: number; sinais: number; vendas: number;
};

export const ORIGENS = ["Instagram", "Formulário da bio", "Prospeção ativa", "Indicação", "WhatsApp", "Evento", "Outro"];

export async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as T;
}

export function msgErro(e: unknown) {
  const m = (e as any)?.message ?? String(e);
  return String(m).slice(0, 220);
}

/** Cargo no funil: socio (fundadores/gerência), closer, cs ou sdr. */
export function useFunilPapel() {
  const { data } = useProfile();
  const papel: "socio" | "closer" | "cs" | "sdr" =
    data?.roles?.includes("socio") || data?.isGerencia ? "socio" : (data?.role as any) ?? "sdr";
  return { papel, memberId: (data?.profile as any)?.member_id as string | null | undefined, nome: (data?.profile as any)?.nome as string | undefined, isSocio: papel === "socio" };
}

/** Quem pode mover cartões para cada etapa. */
export function podeIrPara(papel: string, destino: Etapa) {
  if (papel === "socio") return true;
  if (["novo", "conversa", "qualificado", "followup"].includes(destino)) return papel === "sdr" || papel === "closer";
  if (destino === "call") return papel === "sdr" || papel === "closer";
  if (["realizada", "noshow", "sinal", "venda"].includes(destino)) return papel === "closer";
  if (["onboarding", "aluno"].includes(destino)) return papel === "cs";
  return false;
}

export function useFunilCards() {
  return useQuery({
    queryKey: ["funil_cards"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("funil_cards").select("*").order("etapa_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Card[];
    },
    refetchInterval: 60000,
  });
}

export function useFunilAgenda(de: string, ate: string) {
  return useQuery({
    queryKey: ["funil_agenda", de, ate],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("funil_agenda").select("*").gte("inicio", de).lt("inicio", ate).order("inicio");
      if (error) throw error;
      return (data ?? []) as Agenda[];
    },
    refetchInterval: 60000,
  });
}

/** Tempo real do funil: qualquer mudança no quadro ou na agenda atualiza todos os ecrãs abertos. */
export function useFunilRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel(`funil-${Math.random().toString(36).slice(2)}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "funil_cards" }, () => {
      qc.invalidateQueries({ queryKey: ["funil_cards"] });
      qc.invalidateQueries({ queryKey: ["funil_metricas"] });
    });
    ch.on("postgres_changes", { event: "*", schema: "public", table: "funil_agenda" }, () => qc.invalidateQueries({ queryKey: ["funil_agenda"] }));
    try { ch.subscribe(); } catch { /* sem tempo real, o refetch periódico cobre */ }
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, [qc]);
}

export function diasDesde(iso: string | null) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
export const fmtDiaCurto = (iso: string) => new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
export const hojeISO = () => new Date().toLocaleDateString("sv-SE");
