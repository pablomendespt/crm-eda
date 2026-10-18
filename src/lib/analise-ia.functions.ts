// Stub: versão estática (SPA) sem funções de servidor.
export type ResumirDesempenhoResult =
  | { ok: true; texto: string }
  | { ok: false; error: string };

export async function resumirDesempenho(
  _opts?: { data: { inicio: string; fim: string; foco?: string } } | unknown,
): Promise<ResumirDesempenhoResult> {
  throw new Error("Funcionalidade indisponível nesta versão");
}
