import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = ["https://pablomendespt.github.io", "http://localhost:5173", "http://localhost:4173"];
const MODEL = "claude-sonnet-5-5";

function corsFor(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.includes(o) ? o : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SYSTEM = `És analista comercial da Europa Digital Academy. Escreves em português de Portugal, direto, frases curtas, sem superlativos nem linguagem de guru. Valores em euros escritos por extenso numérico (ex.: 11 306,05 €), nunca "k". Usa apenas os dados fornecidos; nunca inventes números. Os dias sem registo diário já vêm preenchidos com ZERO — trata-os como zero atividade, nunca como "falta de registo" ou "dias sem registo". Um zero num dia útil pode ser apontado como desvio de atividade, mas como número zero, não como dado em falta.
Formato em Markdown, exatamente estas secções:
## Resumo
(3 a 5 linhas com os números principais)
## Desvios
(lista: quem, que número, porquê é um desvio — ex.: 0 atividade num dia útil, conversão baixa, muitos "não compareceu")
## Prioridades para o daily
(lista numerada, no máximo 5, cada uma com responsável e ação concreta)`;

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Método não permitido." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const auth = req.headers.get("Authorization") ?? "";

  // as RPCs de dados validam o utilizador pelo JWT, por isso usamos o cliente dele
  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return json(401, { ok: false, error: "Sessão inválida. Entre de novo." });

  const { data: isSocio } = await sb.rpc("has_role", { _user_id: u.user.id, _role: "socio" });
  if (!isSocio) return json(200, { ok: false, error: "Só a gerência pode usar esta análise." });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Pedido inválido." }); }
  const inicio = body?.inicio, fim = body?.fim;
  const foco = typeof body?.foco === "string" ? body.foco.slice(0, 500) : undefined;
  if (!DATE.test(inicio ?? "") || !DATE.test(fim ?? "")) return json(400, { ok: false, error: "Datas inválidas." });
  if (inicio > fim) return json(200, { ok: false, error: "A data de início é depois da data de fim." });
  if (!apiKey) return json(200, { ok: false, error: "A IA ainda não está configurada (falta a chave ANTHROPIC_API_KEY)." });

  const [m, ca, v, c, sdFin] = await Promise.all([
    sb.from("members").select("id, nome, role").eq("ativo", true),
    sb.rpc("calls_analise", { p_from: inicio, p_to: fim, p_base: "realizacao" }),
    sb.rpc("fin_resumo_mes", { p_from: inicio, p_to: fim, p_produto: null, p_closer: null }),
    sb.rpc("fin_resumo_membro", { p_from: inicio, p_to: fim, p_produto: null, p_closer: null, p_papel: "closer" }),
    sb.rpc("fin_resumo_membro", { p_from: inicio, p_to: fim, p_produto: null, p_closer: null, p_papel: "sdr" }),
  ]);
  const err = m.error ?? ca.error ?? v.error ?? c.error ?? sdFin.error;
  if (err) return json(200, { ok: false, error: "Não foi possível ler os dados da equipa." });

  const analysis: any = ca.data ?? { membros: [], dias: [] };
  const summary: any = (v.data as any[])?.[0];
  const cls = new Map<string, any>(((c.data as any[]) ?? []).map((r) => [r.member_id, r]));
  const sds = new Map<string, any>(((sdFin.data as any[]) ?? []).map((r) => [r.member_id, r]));
  const members: any[] = m.data ?? [];

  const sdrs = members.filter((x) => x.role === "sdr").map((s) => {
    const r = analysis.membros?.find((mm: any) => mm.member_id === s.id)?.resumo;
    const porDia = Object.fromEntries(
      (analysis.dias ?? []).filter((d: any) => d.member_id === s.id).map((d: any) => [d.dia, d.resumo.marcadas]),
    );
    return {
      nome: s.nome,
      calls_marcadas: r?.marcadas ?? 0,
      calls_realizadas: r?.realizadas ?? 0,
      por_validar: r?.por_validar ?? 0,
      por_dia: porDia,
      vendas_como_sdr: sds.get(s.id)?.vendas ?? 0,
      bruto_como_sdr: sds.get(s.id)?.bruto ?? 0,
    };
  });
  const closers = members.filter((x) => x.role === "closer").map((cl) => {
    const r = analysis.membros?.find((mm: any) => mm.member_id === cl.id)?.resumo;
    const realizadas = r?.realizadas ?? 0;
    const vendas = cls.get(cl.id)?.vendas ?? 0;
    return {
      nome: cl.nome,
      calls_realizadas: realizadas,
      por_validar: r?.por_validar ?? 0,
      nao_compareceu: r?.nao_compareceu ?? 0,
      vendas,
      conversao_pct: realizadas ? Math.round((vendas / realizadas) * 100) : null,
      caixa_liquido_eur: Math.round((cls.get(cl.id)?.liquido ?? 0) * 100) / 100,
      bruto_eur: cls.get(cl.id)?.bruto ?? 0,
      sinais: cls.get(cl.id)?.sinais ?? 0,
    };
  });

  const dados = {
    periodo: { inicio, fim },
    equipa: { bruto_eur: summary?.bruto ?? 0, liquido_eur: summary?.liquido ?? 0, vendas: summary?.vendas ?? 0, sinais: summary?.sinais ?? 0 },
    sdrs,
    closers,
  };
  const prompt = `Dados do período (JSON):\n${JSON.stringify(dados)}${foco ? `\n\nFoco pedido pela gerência: ${foco}` : ""}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) return json(200, { ok: false, error: j?.error?.message ?? "Erro na IA." });
    const texto = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (!texto) return json(200, { ok: false, error: "A IA não devolveu texto." });
    return json(200, { ok: true, texto });
  } catch (e) {
    return json(200, { ok: false, error: (e as Error).message ?? "Erro na IA." });
  }
});
