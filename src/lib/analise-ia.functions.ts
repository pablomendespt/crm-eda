import { callEdge } from "./edge";

export type ResumirDesempenhoResult =
  | { ok: true; texto: string }
  | { ok: false; error: string };

// Resumo com IA via Edge Function `resumo-ia` (só sócios).
export async function resumirDesempenho(
  opts: { data: { inicio: string; fim: string; foco?: string } },
): Promise<ResumirDesempenhoResult> {
  try {
    return await callEdge<ResumirDesempenhoResult>("resumo-ia", opts.data);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Erro na IA." };
  }
}
