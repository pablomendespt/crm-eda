// Constantes da Central de Leads (tabela leads_consolidados).

export const CALL_STATUS = [
  { key: "call_marcada", label: "Call marcada", color: "var(--accent-bright, var(--accent))" },
  { key: "call_realizada", label: "Call realizada", color: "var(--accent)" },
  { key: "nao_compareceu", label: "Não compareceu", color: "var(--red)" },
  { key: "reagendado", label: "Reagendado", color: "#a78bfa" },
  { key: "follow_up", label: "Follow-up", color: "var(--gold)" },
  { key: "em_fechamento", label: "Em fechamento", color: "#f59e0b" },
  { key: "fechado", label: "Fechado", color: "var(--green)" },
  { key: "nao_concluiu", label: "Não concluiu", color: "color-mix(in srgb, var(--red) 65%, var(--text3))" },
  { key: "sem_interesse", label: "Sem interesse", color: "var(--text3)" },
  { key: "desqualificado", label: "Desqualificado pelo Closer", color: "#f97316" },
  { key: "reembolso_solicitado", label: "Reembolso solicitado", color: "#fb923c" },
  { key: "reembolsado", label: "Reembolsado", color: "var(--red)" },
] as const;
export type CallStatus = (typeof CALL_STATUS)[number]["key"];

export function callStatusInfo(k: string | null | undefined) {
  return CALL_STATUS.find((s) => s.key === k) ?? { key: k ?? "", label: k ?? "—", color: "var(--text3)" };
}

export const QUALIFICACAO = [
  { key: "nao_definido", label: "Não definido" },
  { key: "qualificado", label: "Qualificado" },
  { key: "desqualificado", label: "Desqualificado" },
] as const;

export const MOTIVOS_DESQ = [
  "Financeiro", "Sem prioridade", "Sem tempo", "Sem urgência", "Não é decisor",
  "Expectativa incompatível", "Perfil inadequado", "Outro",
];

export const FONTES = ["Instagram Leandro", "Instagram Pablo", "Anúncio", "Indicação", "Ligação", "Outro"];
export const PRODUTOS = ["Europa Digital Academy", "PVE", "Evento 100K"];
export const METODOS = ["Klarna", "Cartão - à vista", "Pagamento Recorrente", "MB Way", "Transferência"];

// Filtros rápidos (visões da mesma Central).
export const FILTROS_RAPIDOS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "todos", label: "Todos", match: () => true },
  { key: "call_marcada", label: "Call marcada", match: (s) => s === "call_marcada" },
  { key: "realizadas", label: "Realizadas", match: (s) => s === "call_realizada" },
  { key: "nao_compareceu", label: "Não compareceu", match: (s) => s === "nao_compareceu" },
  { key: "reagendado", label: "Reagendados", match: (s) => s === "reagendado" },
  { key: "follow_up", label: "Follow-up", match: (s) => s === "follow_up" },
  { key: "em_fechamento", label: "Em fechamento", match: (s) => s === "em_fechamento" },
  { key: "fechado", label: "Fechados", match: (s) => s === "fechado" },
  { key: "desqualificado", label: "Desqualificados", match: (s) => s === "desqualificado" },
  { key: "reembolso", label: "Reembolso", match: (s) => s === "reembolso_solicitado" || s === "reembolsado" },
];

export const HIST_LABEL: Record<string, string> = {
  criado: "Lead criado",
  status: "Status",
  reagendado: "Call reagendada",
  closer: "Closer alterado",
  sinal: "Sinal",
  followup: "Próximo follow-up",
};
