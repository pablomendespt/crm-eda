import type { CallSummary } from '@/lib/calls-reporting';
// Feedback Operacional — motor de regras (sem IA).
// Lê apenas números já calculados nos painéis "Meus Números". Não altera cálculos.

export type Nivel = "excelente" | "saudavel" | "atencao" | "critico";
export type Area = "volume" | "conversao" | "constancia" | "financeiro";

export interface Sinal {
  id: string;
  area: Area;
  nivel: Nivel;
  titulo: string;
  evidencia: string;
  acao: string;
  elogio?: string;
  amostraOk: boolean;
  ordem: number; // ordem do diagnóstico (menor = analisado primeiro)
}

export interface Feedback {
  nota: number;
  provisoria: boolean;
  divergencias: string[];
  gargalo: Sinal | null;
  pontoForte: string | null;
  atencao: Sinal | null;
  detalhes: Sinal[];
  semDados: boolean;
}

const SCORE: Record<Nivel, number> = { excelente: 10, saudavel: 7.5, atencao: 5, critico: 2 };
const PESO: Record<Area, number> = { volume: 0.25, conversao: 0.35, financeiro: 0.25, constancia: 0.15 };

const n1 = (v: number) => v.toFixed(1).replace(".", ",");
const p0 = (v: number) => `${Math.round(v)}%`;
const eur = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

function nivelAlto(v: number, exc: number, sau: number, at: number): Nivel {
  if (v >= exc) return "excelente";
  if (v >= sau) return "saudavel";
  if (v >= at) return "atencao";
  return "critico";
}
function nivelBaixo(v: number, sau: number, at: number, crit: number): Nivel {
  // para métricas onde menor é melhor (no-show)
  if (v <= sau) return "saudavel";
  if (v < crit) return v <= at ? "atencao" : "atencao";
  return "critico";
}
const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

// ---------- Constância ----------
export function analisarConstancia(serie: number[], nome: string): Sinal | null {
  const dias = serie.length;
  if (dias < 4) return null;
  const media = serie.reduce((s, v) => s + v, 0) / dias;
  if (media <= 0) return null;
  const desvio = Math.sqrt(serie.reduce((s, v) => s + (v - media) ** 2, 0) / dias);
  const cv = desvio / media;
  let seq = 0, maxSeq = 0;
  for (const v of serie) { seq = v < media * 0.5 ? seq + 1 : 0; maxSeq = Math.max(maxSeq, seq); }
  const fmt = serie.map((v) => Math.round(v)).join(" → ");
  if (cv > 0.8 || maxSeq >= 3) {
    return {
      id: "constancia", area: "constancia", ordem: 4,
      nivel: cv > 1 || maxSeq >= 4 ? "critico" : "atencao",
      titulo: "Resultado irregular durante o período",
      evidencia: `${nome} por dia: ${fmt}${maxSeq >= 3 ? ` · ${maxSeq} dias seguidos muito abaixo da tua média` : ""}`,
      acao: "Revê organização e consistência da execução. Define um mínimo diário e cumpre-o todos os dias.",
      amostraOk: true,
    };
  }
  return {
    id: "constancia", area: "constancia", ordem: 4, nivel: cv < 0.4 ? "excelente" : "saudavel",
    titulo: "Execução constante", evidencia: `${nome} por dia: ${fmt}`, acao: "",
    elogio: "Teu ritmo diário está consistente. Mantém esse padrão.", amostraOk: true,
  };
}

// ---------- Comparação com período anterior ----------
function comparar(atual: number, anterior: number, nome: string): Sinal | null {
  if (anterior <= 0) return null;
  const varPct = ((atual - anterior) / anterior) * 100;
  if (varPct <= -30) {
    return {
      id: "queda", area: "constancia", ordem: 4, nivel: "atencao",
      titulo: `Queda forte em ${nome.toLowerCase()} face ao período anterior`,
      evidencia: `${nome}: ${n1(atual)} agora contra ${n1(anterior)} no período anterior (${p0(varPct)})`,
      acao: "Identifica o que mudou face ao período anterior e recupera a rotina que estava a funcionar.",
      amostraOk: true,
    };
  }
  if (varPct >= 15) {
    return {
      id: "subida", area: "constancia", ordem: 9, nivel: "excelente",
      titulo: "", evidencia: "", acao: "",
      elogio: `Estás ${p0(varPct)} acima do período anterior em ${nome.toLowerCase()}.`, amostraOk: true,
    };
  }
  return null;
}

// ---------- Montagem final ----------
function montar(sinais: Sinal[], divergencias: string[], semDados: boolean): Feedback {
  const validos = sinais.filter((s) => s.titulo || s.elogio);
  // Nota
  let soma = 0, pesos = 0, provisoria = false;
  (Object.keys(PESO) as Area[]).forEach((a) => {
    const da = validos.filter((s) => s.area === a && s.id !== "subida");
    const comAmostra = da.filter((s) => s.amostraOk);
    if (!comAmostra.length) { provisoria = provisoria || da.length > 0 || a !== "constancia"; return; }
    const media = comAmostra.reduce((s, x) => s + SCORE[x.nivel], 0) / comAmostra.length;
    soma += media * PESO[a]; pesos += PESO[a];
  });
  if (validos.some((s) => !s.amostraOk)) provisoria = true;
  const nota = pesos ? Math.round((soma / pesos) * 10) / 10 : 0;

  const problemas = validos
    .filter((s) => s.nivel === "critico" || s.nivel === "atencao")
    .sort((a, b) => (a.nivel === b.nivel ? a.ordem - b.ordem : a.nivel === "critico" ? -1 : 1));
  // Sinais com amostra suficiente ganham prioridade como gargalo
  const ordenados = [...problemas.filter((s) => s.amostraOk), ...problemas.filter((s) => !s.amostraOk)];
  const gargalo = ordenados[0] ?? null;
  const atencao = ordenados.find((s) => s !== gargalo) ?? null;

  const bons = validos.filter((s) => (s.nivel === "excelente" || s.nivel === "saudavel") && s.elogio);
  bons.sort((a, b) => (a.nivel === b.nivel ? a.ordem - b.ordem : a.nivel === "excelente" ? -1 : 1));
  const pontoForte = bons[0]?.elogio ?? null;

  // Sem problemas: identifica a principal oportunidade de otimização (o mais fraco entre os saudáveis)
  let g = gargalo;
  if (!g) {
    const saud = validos.filter((s) => s.nivel === "saudavel" && s.titulo && s.acao);
    if (saud.length) g = { ...saud.sort((a, b) => a.ordem - b.ordem)[0] };
  }
  return { nota, provisoria, divergencias, gargalo: g, pontoForte, atencao, detalhes: validos, semDados };
}

// =============== SDR ===============
export interface SdrInput {
  rows: any[]; // sdr_daily do período (já filtrado)
  prevRows: any[];
  calls: CallSummary;
  bruto: number;
  liquido: number;
}

export function avaliarSdr({ rows, prevRows, bruto, liquido, calls }: SdrInput): Feedback {
  const sum = (rs: any[], k: string) => rs.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const dias = new Set(rows.map((r) => r.data)).size;
  if (!dias) return montar([], [], true);

  const conversas = sum(rows, "conversas_iniciadas");
  const respostas = sum(rows, "respostas_1a");
  const ligacoes = sum(rows, "ligacoes_feitas");
  const atendidas = sum(rows, "ligacoes_atendidas");
  const marcadas = calls.marcadas;
  const realizadas = calls.realizadas;
  const agLig = sum(rows, "agendamentos_ligacao");

  const div: string[] = [];
  if (respostas > conversas) div.push(`Respostas (${respostas}) maiores que conversas iniciadas (${conversas}).`);
  if (atendidas > ligacoes) div.push(`Ligações atendidas (${atendidas}) maiores que ligações feitas (${ligacoes}).`);
  if (agLig > atendidas && atendidas > 0) div.push(`Agendamentos por ligação (${agLig}) maiores que ligações atendidas (${atendidas}).`);
  if (realizadas > marcadas && marcadas > 0) div.push(`Calls realizadas (${realizadas}) maiores que calls marcadas (${marcadas}).`);

  const s: Sinal[] = [];
  const convDia = conversas / dias;
  const ligDia = ligacoes / dias;

  // Volume
  const nvConv = nivelAlto(convDia, 40, 30, 21);
  s.push({
    id: "conv-dia", area: "volume", ordem: 2, nivel: nvConv, amostraOk: true,
    titulo: "Volume de conversas abaixo do esperado",
    evidencia: `${n1(convDia)} conversas iniciadas por dia (saudável: 30+, excelente: 40+)`,
    acao: "Bloqueia horários fixos de prospecção e só sai depois de atingir 30 conversas iniciadas.",
    elogio: nvConv === "excelente" ? `Volume excelente: ${n1(convDia)} conversas por dia.` : `Volume saudável: ${n1(convDia)} conversas por dia.`,
  });
  if (ligacoes > 0 || true) {
    const nvLig = nivelAlto(ligDia, 30, 30, 20);
    s.push({
      id: "lig-dia", area: "volume", ordem: 2, nivel: nvLig === "excelente" ? "saudavel" : nvLig, amostraOk: true,
      titulo: "Poucos leads trabalhados por ligação",
      evidencia: `${n1(ligDia)} ligações por dia (meta: 30 leads por dia; até 3 tentativas ao mesmo lead contam como 1)`,
      acao: "Reserva um bloco diário só para ligações até contactar 30 leads.",
      elogio: `Meta de ligações cumprida: ${n1(ligDia)} por dia.`,
    });
  }

  // Conversão
  const taxaResp = ratio(respostas, conversas);
  const nvResp = nivelAlto(taxaResp, 40, 30, 21);
  const taxaAg = ratio(marcadas, respostas);
  const nvAg = nivelAlto(taxaAg, 40, 25, 11);
  const respOk = conversas >= 100;
  const agOk = respostas >= 30;
  const respBoa = nvResp === "excelente" || nvResp === "saudavel";
  const agBom = nvAg === "excelente" || nvAg === "saudavel";

  s.push({
    id: "resp", area: "conversao", ordem: 3, nivel: nvResp, amostraOk: respOk,
    titulo: !respBoa && agBom ? "Gargalo no primeiro contacto (topo de funil)" : "Taxa de resposta baixa",
    evidencia: `${p0(taxaResp)} de resposta (${respostas} de ${conversas} conversas; saudável: 30%+)${respOk ? "" : " · amostra ainda pequena"}`,
    acao: !respBoa && agBom
      ? "Conduzes bem quem responde. Mantém a condução e foca no primeiro contacto: qualidade da 1ª mensagem, velocidade, origem e temperatura do lead, follow-up."
      : "Verifica a qualidade da 1ª mensagem, a velocidade do primeiro contacto, a demora a responder durante a conversa, a origem do lead e o follow-up.",
    elogio: `Boa taxa de resposta: ${p0(taxaResp)}.`,
  });
  s.push({
    id: "agend", area: "conversao", ordem: 3, nivel: nvAg, amostraOk: agOk,
    titulo: respBoa && !agBom ? "Problema de condução: respondem, mas não marcam" : "Taxa de agendamento baixa",
    evidencia: `${p0(taxaAg)} de agendamento (${marcadas} calls de ${respostas} respostas; saudável: 25%+)${agOk ? "" : " · amostra ainda pequena"}`,
    acao: "Revê o processo: velocidade de resposta, aprofundamento, identificação de oportunidade, pitch do agendamento e excesso de qualificação.",
    elogio: `Condução forte: ${p0(taxaAg)} das respostas viram call marcada.`,
  });

  // No-show (marcadas que não se realizaram)
  if (marcadas >= 5 && realizadas > 0) {
    const ns = ratio(Math.max(0, marcadas - realizadas), marcadas);
    const nv: Nivel = ns <= 10 ? "saudavel" : ns >= 35 ? "critico" : "atencao";
    s.push({
      id: "noshow", area: "conversao", ordem: 3.5, nivel: nv, amostraOk: marcadas >= 10,
      titulo: "No-show alto nas calls marcadas",
      evidencia: `${p0(ns)} das calls marcadas não aconteceram (${marcadas - realizadas} de ${marcadas}; saudável: até 10%)`,
      acao: "Reforça a pré-call: envia conteúdo, aquece o lead, confirma por ligação antes da reunião e gera mais compromisso.",
      elogio: `No-show controlado: ${p0(ns)}.`,
    });
  }

  // Constância
  const porDia = new Map<string, number>();
  rows.forEach((r) => porDia.set(r.data, (porDia.get(r.data) ?? 0) + Number(r.conversas_iniciadas ?? 0) / 10));
  const serie = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const c = analisarConstancia(serie, "Atividade (calls marcadas + conversas/10)");
  if (c) s.push(c);
  const prevDias = new Set(prevRows.map((r) => r.data)).size;
  if (prevDias) {
    const cmp = comparar(convDia, sum(prevRows, "conversas_iniciadas") / prevDias, "Conversas por dia");
    if (cmp) s.push(cmp);
  }

  // Financeiro (qualidade, não critério único)
  if (marcadas >= 5) {
    const volumeBom = nvConv === "excelente" || nvConv === "saudavel";
    if (bruto <= 0 && volumeBom) {
      s.push({
        id: "fin", area: "financeiro", ordem: 6, nivel: "atencao", amostraOk: marcadas >= 10,
        titulo: "Volume alto, mas pouco resultado financeiro",
        evidencia: `${marcadas} calls marcadas e ${eur(bruto)} faturados pelos teus leads`,
        acao: "Analisa a qualidade dos agendamentos: o lead tem perfil e intenção real antes de marcar?",
      });
    } else if (bruto > 0) {
      s.push({
        id: "fin", area: "financeiro", ordem: 6, nivel: liquido >= bruto * 0.5 ? "excelente" : "saudavel", amostraOk: true,
        titulo: "", evidencia: `${eur(bruto)} faturados e ${eur(liquido)} em caixa`, acao: "",
        elogio: `Teus leads geraram ${eur(bruto)} em faturamento e ${eur(liquido)} em caixa.`,
      });
    }
  }

  // Regra volume x técnica
  const volMau = nvConv === "atencao" || nvConv === "critico";
  const tecMau = (!respBoa && respOk) || (!agBom && agOk);
  if (volMau && tecMau) s.forEach((x) => { if (x.area === "conversao") x.ordem = 1.5; });

  return montar(s, div, false);
}

// =============== CLOSER ===============
export interface CloserInput {
  rows: any[];
  prevRows: any[];
  calls: CallSummary;
  bruto: number;
  liquido: number;
  nVendas: number;
  nSinais: number;
}

export function avaliarCloser({ rows, prevRows, bruto, liquido, nVendas, nSinais, calls }: CloserInput): Feedback {
  const sum = (rs: any[], k: string) => rs.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const dias = new Set(rows.map((r) => r.data)).size;
  if (!dias && !nVendas) return montar([], [], true);

  const recebidas = calls.marcadas;
  const realizadas = calls.realizadas;
  const noshow = calls.nao_compareceu;

  const div: string[] = [];
  if (realizadas + noshow > recebidas && recebidas > 0)
    div.push(`Calls realizadas + no-show (${realizadas + noshow}) maiores que calls recebidas (${recebidas}).`);
  if (nVendas > realizadas && realizadas > 0)
    div.push(`Vendas fechadas (${nVendas}) maiores que calls realizadas (${realizadas}).`);
  if (nVendas > 0 && realizadas === 0) div.push(`Existem ${nVendas} vendas, mas nenhuma call realizada registada.`);

  const s: Sinal[] = [];
  const realDia = dias ? realizadas / dias : 0;
  const recDia = dias ? recebidas / dias : 0;

  // Volume
  const nvVol = nivelAlto(realDia, 4, 3, 2);
  const poucasRecebidas = recDia < 3;
  s.push({
    id: "calls-dia", area: "volume", ordem: 2,
    nivel: poucasRecebidas && (nvVol === "atencao" || nvVol === "critico") ? "saudavel" : nvVol,
    amostraOk: dias >= 3,
    titulo: poucasRecebidas ? "Poucas calls a chegar" : "Poucas calls realizadas por dia",
    evidencia: `${n1(realDia)} calls realizadas por dia, ${n1(recDia)} recebidas por dia (saudável: 3, excelente: 4+)`,
    acao: poucasRecebidas
      ? "O volume depende do agendamento. Enquanto chegam poucas calls, usa o tempo livre para trabalhar follows e sinais."
      : "Garante que todas as calls recebidas acontecem e mantém a agenda cheia.",
    elogio: `Bom volume: ${n1(realDia)} calls realizadas por dia.`,
  });

  // No-show
  if (realizadas + noshow > 0) {
    const ns = ratio(noshow, realizadas + noshow);
    const nv: Nivel = ns <= 10 ? "saudavel" : ns >= 35 ? "critico" : "atencao";
    s.push({
      id: "noshow", area: "conversao", ordem: 3.5, nivel: nv, amostraOk: realizadas + noshow >= 10,
      titulo: "No-show alto",
      evidencia: `${p0(ns)} de no-show (${noshow} de ${realizadas + noshow} calls; saudável: até 10%)`,
      acao: "Apresenta-te mais no grupo da call e gera proximidade com o lead antes da reunião. Alinha a confirmação com o SDR.",
      elogio: `No-show controlado: ${p0(ns)}.`,
    });
  }

  // Fecho
  const fecho = ratio(nVendas, realizadas);
  const nvF = nivelAlto(fecho, 40, 30, 16);
  const fechoOk = realizadas >= 20;
  const fechoBom = nvF === "excelente" || nvF === "saudavel";
  if (realizadas > 0) {
    s.push({
      id: "fecho", area: "conversao", ordem: 3, nivel: nvF, amostraOk: fechoOk,
      titulo: "Taxa de fecho baixa",
      evidencia: `${p0(fecho)} de fecho (${nVendas} vendas em ${realizadas} calls; saudável: 30%+)`,
      acao: fechoOk
        ? "Analisa as calls realizadas junto com o gestor para identificar onde o processo está a quebrar."
        : "A amostra ainda é pequena, mas tua conversão merece atenção. Revê as últimas calls com o gestor.",
      elogio: nvF === "excelente" ? `Parabéns. Tua taxa de fecho está excelente (${p0(fecho)}).` : `Taxa de fecho saudável: ${p0(fecho)}.`,
    });
  }

  // Financeiro
  if (bruto > 0) {
    const caixa = ratio(liquido, bruto);
    const nvC = nivelAlto(caixa, 70, 50, 21);
    s.push({
      id: "caixa", area: "financeiro", ordem: 6, nivel: nvC, amostraOk: nVendas >= 3,
      titulo: fechoBom ? "Vendes bem, mas coletas pouco caixa" : "Taxa de caixa coletado baixa",
      evidencia: `${p0(caixa)} de caixa coletado (${eur(liquido)} de ${eur(bruto)}; saudável: 50%+)`,
      acao: "Negocia melhor, reduz menos o valor e procura coletar mais caixa durante a reunião.",
      elogio: `Excelente coleta de caixa: ${p0(caixa)} do faturado.`,
    });
    const ticket = bruto / Math.max(nVendas, 1);
    const nvT: Nivel = ticket >= 997 ? "excelente" : ticket >= 497 ? "saudavel" : ticket > 297 ? "atencao" : "critico";
    s.push({
      id: "ticket", area: "financeiro", ordem: 6.5, nivel: fechoBom && nvT !== "excelente" && nvT !== "saudavel" ? "atencao" : nvT,
      amostraOk: nVendas >= 3,
      titulo: fechoBom ? "Fechas bem, mas com ticket baixo" : "Ticket médio baixo",
      evidencia: `Ticket médio de ${eur(ticket)} (bom: 497 € a 697 €, excelente: 997 €)`,
      acao: "Apresenta primeiro a oferta completa e defende o valor antes de abrir descontos.",
      elogio: `Ticket médio forte: ${eur(ticket)}.`,
    });
  }

  // Sinais
  if (nSinais + nVendas > 0 && nSinais > 0) {
    const conv = ratio(nVendas, nSinais + nVendas);
    const nv: Nivel = conv >= 50 ? "saudavel" : conv >= 20 ? "atencao" : "critico";
    s.push({
      id: "sinais", area: "financeiro", ordem: 7, nivel: nv, amostraOk: nSinais + nVendas >= 5,
      titulo: "Sinais por converter",
      evidencia: `${nSinais} sinais em aberto · conversão sinal → venda de ${p0(conv)} (saudável: 50%+)`,
      acao: "Tens oportunidades próximas do fecho. Intensifica os follows para transformar esses sinais em vendas.",
      elogio: `Boa conversão de sinais: ${p0(conv)}.`,
    });
  }

  return montar(s, div, false);
}
