// Traduz erros do Supabase/PostgREST para mensagens amigáveis em PT.
// Foco principal: RLS (permissões) e erros comuns de rede/validação.

type AnyErr = {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
  hint?: string;
} | Error | unknown;

function pick(e: AnyErr): { msg: string; code?: string; status?: number; details?: string } {
  if (!e) return { msg: "" };
  if (typeof e === "string") return { msg: e };
  const o = e as Record<string, unknown>;
  return {
    msg: String(o.message ?? ""),
    code: o.code as string | undefined,
    status: o.status as number | undefined,
    details: o.details as string | undefined,
  };
}

/**
 * Devolve uma mensagem amigável em português.
 * Detecta: RLS (42501 / new row violates row-level security / permission denied),
 * 401/403, conflitos (23505), FK (23503), NOT NULL (23502), rede.
 */
export function friendlyError(err: AnyErr, fallback = "Ocorreu um erro inesperado."): string {
  const { msg, code, status } = pick(err);
  const m = msg.toLowerCase();

  // RLS / permissões
  if (
    code === "42501" ||
    code === "PGRST301" ||
    status === 401 ||
    status === 403 ||
    m.includes("row-level security") ||
    m.includes("row level security") ||
    m.includes("permission denied") ||
    m.includes("not authorized") ||
    m.includes("unauthorized") ||
    m.includes("violates row-level")
  ) {
    return "Acesso bloqueado: não tens permissão para ver ou alterar estes dados. Fala com um Sócio se precisares de acesso.";
  }

  // Sessão expirada
  if (m.includes("jwt") && (m.includes("expired") || m.includes("invalid"))) {
    return "A sessão expirou. Volta a iniciar sessão.";
  }

  // Conflitos / integridade
  if (code === "23505") return "Já existe um registo com estes dados (duplicado).";
  if (code === "23503") return "Esta ação viola uma ligação com outro registo.";
  if (code === "23502") return "Faltam campos obrigatórios.";
  if (code === "23514") return "Os dados não cumprem uma regra de validação.";

  // Rede
  if (m.includes("failed to fetch") || m.includes("networkerror")) {
    return "Sem ligação ao servidor. Verifica a internet e tenta novamente.";
  }

  return msg || fallback;
}

export function isRlsError(err: AnyErr): boolean {
  const { msg, code, status } = pick(err);
  const m = msg.toLowerCase();
  return (
    code === "42501" ||
    code === "PGRST301" ||
    status === 401 ||
    status === 403 ||
    m.includes("row-level security") ||
    m.includes("permission denied")
  );
}
