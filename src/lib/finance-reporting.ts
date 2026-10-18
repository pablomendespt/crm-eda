import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FinanceSummary = { bruto: number; liquido: number; vendas: number; recorrencia: number | null; ticket_medio: number; sinais: number; valor_sinais: number };
export type FinanceMember = Omit<FinanceSummary, "recorrencia"> & { member_id: string; nome: string };
export type FinanceSeries = { inicio: string; fim: string; bruto: number; liquido: number; vendas: number; ticket_medio: number };
export const EMPTY_SUMMARY: FinanceSummary = { bruto: 0, liquido: 0, vendas: 0, recorrencia: null, ticket_medio: 0, sinais: 0, valor_sinais: 0 };
export const EMPTY_MEMBER: FinanceMember = { bruto: 0, liquido: 0, vendas: 0, ticket_medio: 0, sinais: 0, valor_sinais: 0, member_id: "", nome: "" };

export async function financeRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error) throw error;
  return data as T;
}
export function useFinanceSummary(from: string, to: string, produto = "", closer = "") {
  return useQuery({ queryKey: ["finance", "summary", from, to, produto, closer],
    queryFn: async () => (await financeRpc<FinanceSummary[]>("fin_resumo_mes", { p_from: from, p_to: to, p_produto: produto || null, p_closer: closer || null }))[0] ?? EMPTY_SUMMARY });
}
export function useFinanceMembers(from: string, to: string, papel = "closer", produto = "", closer = "") {
  return useQuery({ queryKey: ["finance", "members", from, to, papel, produto, closer],
    queryFn: () => financeRpc<FinanceMember[]>("fin_resumo_membro", { p_from: from, p_to: to, p_produto: produto || null, p_closer: closer || null, p_papel: papel }) });
}
export function useFinanceSeries(from: string, to: string, step = "day", produto = "", closer = "") {
  return useQuery({ queryKey: ["finance", "series", from, to, step, produto, closer],
    queryFn: () => financeRpc<FinanceSeries[]>("fin_series", { p_from: from, p_to: to, p_step: step, p_produto: produto || null, p_closer: closer || null }) });
}
/** Maps already-aggregated server rows, never adds financial values. */
export function reportingShape(summary: FinanceSummary, closers: FinanceMember[] = [], sdrs: FinanceMember[] = []) {
  const dict = (rows: FinanceMember[], key: keyof FinanceMember) => Object.fromEntries(rows.map(r => [r.member_id, Number(r[key] ?? 0)]));
  return { bruto: summary.bruto, liquido: summary.liquido, nVendas: summary.vendas, ticketMedio: summary.ticket_medio,
    nSinais: summary.sinais, valorSinais: summary.valor_sinais,
    brutoPorCloser: dict(closers, "bruto"), liquidoPorCloser: dict(closers, "liquido"), vendasPorCloser: dict(closers, "vendas"),
    brutoPorSdr: dict(sdrs, "bruto"), liquidoPorSdr: dict(sdrs, "liquido"), vendasPorSdr: dict(sdrs, "vendas"),
    sinaisPorCloser: dict(closers, "sinais"), valorSinaisPorCloser: dict(closers, "valor_sinais") };
}
/** One month from fin_mensal: the single monthly rule shared by Anual and Comparativo. */
export type FinanceMonth = { mes: string; bruto: number | null; liquido: number | null; recorrencia: number | null; caixa_total: number | null; vendas: number | null; origem: "vendas" | "registo"; futuro: boolean };
export type FinanceRanking = { member_id: string | null; nome: string; ativo: boolean; vendas: number; bruto: number };
const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
/** "2026-07-01" or "2026-07" → "Julho 2026". */
export function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${MESES_PT[m - 1]} ${y}`;
}
export const MONTH_NAMES = MESES_PT;
/** Ranking position label: 1º, 2º, 3º… */
export const posLabel = (i: number) => `${i + 1}º`;
