import { useQuery } from '@tanstack/react-query';
import { financeRpc } from '@/lib/finance-reporting';
export type CallSummary = { marcadas: number; realizadas: number; nao_compareceu: number; reagendadas: number; canceladas: number; por_validar: number; atrasadas: number; taxa_comparencia: number; hist_marcadas?: number; hist_realizadas?: number; hist_nao_compareceu?: number; hist_reagendadas?: number };
export const EMPTY_CALLS: CallSummary = { marcadas: 0, realizadas: 0, nao_compareceu: 0, reagendadas: 0, canceladas: 0, por_validar: 0, atrasadas: 0, taxa_comparencia: 0 };
export type CallRow = { id: string; nome_lead: string; tel: string | null; email: string | null; sdr_id: string; closer_id: string; lead_id: string | null; agendada_para: string; origem: string; estado: string; validada_em: string | null; call_seguinte_id: string | null; venda_id: string | null; notas: string | null; created_at: string; atrasada: boolean };
export type CallsAnalysis = { membros: { member_id: string; nome: string; papel: string; resumo: CallSummary }[]; dias: { member_id: string; dia: string; resumo: CallSummary }[]; perfis: { origem: string; resumo: CallSummary }[]; extremos: { member_id: string; melhor_marcadas: number; pior_marcadas: number; melhor_realizadas: number; pior_realizadas: number }[]; bonus: { member_id: string; semana: string; realizadas: number; bonus: number; faltam_20: number; faltam_25: number; mensal_realizadas: number; mensal_bonus: number; mensal_faltam: number; mes: string }[] };
export const EMPTY_ANALYSIS: CallsAnalysis = { membros: [], dias: [], perfis: [], bonus: [], extremos: [] };
export function useCallsSummary(from: string, to: string, sdr?: string | null, closer?: string | null, base='realizacao', origem?: string) {
 return useQuery({ queryKey: ['calls', 'summary', from, to, sdr, closer, base, origem], queryFn: async () => (await financeRpc<CallSummary[]>('calls_resumo_total', { p_from: from, p_to: to, p_sdr: sdr && sdr !== 'all' ? sdr : null, p_closer: closer && closer !== 'all' ? closer : null, p_base: base, p_origem: origem || null }))[0] ?? EMPTY_CALLS });
}
export function useCallsAnalysis(from: string, to: string, base='realizacao', sdr?: string | null, closer?: string | null) {
 return useQuery({ queryKey: ['calls', 'analysis', from, to, base, sdr, closer], queryFn: () => financeRpc<CallsAnalysis>('calls_analise', { p_from: from, p_to: to, p_base: base, p_sdr: sdr && sdr !== 'all' ? sdr : null, p_closer: closer && closer !== 'all' ? closer : null }) });
}
export function useCallsList(pending=false) {
 return useQuery({ queryKey: ['calls', 'list', pending], queryFn: () => financeRpc<CallRow[]>('calls_lista', { p_por_validar: pending }), refetchInterval: 60000 });
}
export function callActivity(r: CallSummary) { return { calls_marcadas: r.marcadas, calls_recebidas: r.marcadas, calls_realizadas: r.realizadas, calls_noshow: r.nao_compareceu, calls_remarcadas: r.reagendadas }; }
/** Corte do histórico de referência; totais oficiais usam sempre calls novas. */
export const CALLS_CUTOFF = '2026-10-15';
export function historicoLabel(r: CallSummary) {
 const m=r.hist_marcadas??0, re=r.hist_realizadas??0, n=r.hist_nao_compareceu??0, rg=r.hist_reagendadas??0;
 if(!(m||re||n||rg)) return null;
 return `Histórico (referência, até 14/10/2026): ${m} marcadas · ${re} realizadas · ${n} não compareceu · ${rg} reagendadas`;
}
