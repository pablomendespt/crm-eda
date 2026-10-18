import { useCallsSummary, useCallsAnalysis, EMPTY_ANALYSIS, EMPTY_CALLS, callActivity } from '@/lib/calls-reporting';
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { eur, todayISO, monthStart, weekStart } from "@/lib/format";
import { useProfile } from "@/hooks/useAuth";
import { useMembrosDir } from "@/lib/membros";
import { EMPTY_SUMMARY, EMPTY_MEMBER, useFinanceSummary, useFinanceMembers } from "@/lib/finance-reporting";
import { friendlyError } from "@/lib/rls-error";
import { Trophy, Pencil, CalendarClock, Sparkles } from "lucide-react";
import { EditorMetasMensais, useMetasMensais } from "@/components/MetasMensaisEquipa";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/metas")({
  component: MetasPage,
});

type Papel = "sdr" | "closer" | "cs" | "equipa";
type Periodo = "diaria" | "semanal" | "mensal";

type MetaItem = {
  id: string;
  papel: Papel;
  periodo: Periodo;
  tipo: "checklist" | "bonus" | "coletiva";
  metrica: string | null;
  label: string;
  alvo: number | string | null;
  unidade: "num" | "eur" | "texto";
  bonus: number | string;
  regra: "faixa_max" | "soma";
  grupo: string | null;
  teto: number | string | null;
  nota: string | null;
  ordem: number;
  ativo: boolean;
};

const PAPEL_LABEL: Record<Papel, string> = {
  sdr: "SDR",
  closer: "Closer",
  cs: "Customer Success",
  equipa: "Equipa",
};
const PERIODO_LABEL: Record<Periodo, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

const N = (v: unknown) => Number(v ?? 0);
const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + N(r[k]), 0);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

function fmtAlvo(m: MetaItem) {
  if (m.unidade === "texto" || m.alvo == null) return "—";
  return m.unidade === "eur" ? eur(N(m.alvo)) : new Intl.NumberFormat("pt-PT").format(N(m.alvo));
}
function fmtAtual(v: number, unidade: string) {
  return unidade === "eur" ? eur(v) : new Intl.NumberFormat("pt-PT").format(Math.round(v));
}
function barColor(pct: number) {
  if (pct >= 100) return "var(--green)";
  if (pct >= 60) return "var(--accent)";
  return "var(--gold)";
}

function Bar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${p}%`, background: barColor(pct) }}
      />
    </div>
  );
}

function MetasPage() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const { todos: membros } = useMembrosDir();
  const isSocio = profile?.role === "socio";
  const myMemberId = (profile?.profile as any)?.member_id as string | undefined;

  const papelPessoal: Papel =
    profile?.role === "closer" ? "closer" : profile?.role === "cs" ? "cs" : "sdr";

  const [papelSel, setPapelSel] = useState<Papel | "todos">(isSocio ? "todos" : papelPessoal);
  const [membroSel, setMembroSel] = useState<string>("");
  const [editar, setEditar] = useState(false);

  const hoje = todayISO();
  const mIni = monthStart();
  const sIni = weekStart();
  const memberFiltro = isSocio ? membroSel : (myMemberId ?? "");

  const { data: metas } = useQuery({
    queryKey: ["metas_itens"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metas_itens" as never)
        .select("*")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return ((data ?? []) as unknown as MetaItem[]).filter((m) => (m.tipo as string) !== "mensal_equipa");
    },
  });

  const { data: dados } = useQuery({
    queryKey: ["metas-progresso", mIni],
    queryFn: async () => {
      const [sdr, closer, cs] = await Promise.all([
        supabase.from("sdr_daily").select("*").gte("data", mIni).lte("data", hoje),
        supabase.from("closer_daily").select("*").gte("data", mIni).lte("data", hoje),
        supabase.from("cs_daily" as never).select("*").gte("data", mIni).lte("data", hoje),
      ]);
      return {
        sdr: (sdr.data ?? []) as any[],
        closer: (closer.data ?? []) as any[],
        cs: (cs.data ?? []) as any[],
      };
    },
  });

  const { data: fatMes = EMPTY_SUMMARY } = useFinanceSummary(mIni, `${mIni.slice(0, 7)}-${new Date(Number(mIni.slice(0,4)), Number(mIni.slice(5,7)), 0).getDate()}`);
  const { data: monthlyTargets } = useMetasMensais(mIni);
  const alvoColetivo = N(monthlyTargets?.bruto?.alvo ?? 0);
  const pctColetivo = alvoColetivo > 0 ? (fatMes.bruto / alvoColetivo) * 100 : 0;
  const { data: finDia } = useFinanceMembers(hoje, hoje);
  const { data: finSemana } = useFinanceMembers(sIni, hoje);
  const { data: finMes } = useFinanceMembers(mIni, hoje);
  const { data: finSdrDia } = useFinanceMembers(hoje, hoje, "sdr");
  const { data: finSdrSemana } = useFinanceMembers(sIni, hoje, "sdr");
  const { data: finSdrMes } = useFinanceMembers(mIni, hoje, "sdr");
  const { data: resumoDia = EMPTY_SUMMARY } = useFinanceSummary(hoje, hoje);
  const { data: resumoSemana = EMPTY_SUMMARY } = useFinanceSummary(sIni, hoje);
  const { data: resumoMes = EMPTY_SUMMARY } = useFinanceSummary(mIni, hoje);

  const {data:callDay=EMPTY_ANALYSIS}=useCallsAnalysis(hoje,hoje);
  const {data:callWeek=EMPTY_ANALYSIS}=useCallsAnalysis(sIni,hoje);
  const {data:callMonth=EMPTY_ANALYSIS}=useCallsAnalysis(mIni,hoje);
  const {data:allCallsDay=EMPTY_CALLS}=useCallsSummary(hoje,hoje);
  const {data:allCallsWeek=EMPTY_CALLS}=useCallsSummary(sIni,hoje);
  const {data:allCallsMonth=EMPTY_CALLS}=useCallsSummary(mIni,hoje);
  function callPeriod(periodo: Periodo,papel:Papel){if(!memberFiltro)return periodo==='diaria'?allCallsDay:periodo==='semanal'?allCallsWeek:allCallsMonth;const a=periodo==='diaria'?callDay:periodo==='semanal'?callWeek:callMonth;return a.membros.find(m=>m.member_id===memberFiltro && m.papel===papel)?.resumo ?? EMPTY_CALLS;}
  // --------- Progresso por métrica / cargo / período ----------
  function rangeDe(periodo: Periodo) {
    if (periodo === "diaria") return { from: hoje, to: hoje };
    if (periodo === "semanal") return { from: sIni, to: hoje };
    return { from: mIni, to: hoje };
  }

  function linhas(tabela: "sdr" | "closer" | "cs", periodo: Periodo) {
    const { from, to } = rangeDe(periodo);
    return (dados?.[tabela] ?? []).filter(
      (r: any) =>
        inRange(String(r.data).slice(0, 10), from, to) &&
        (!memberFiltro || r.member_id === memberFiltro),
    );
  }

  function financeiroPeriodo(periodo: Periodo, papel: Papel) {
    const rows = papel === "sdr" ? (periodo === "diaria" ? finSdrDia : periodo === "semanal" ? finSdrSemana : finSdrMes)
      : periodo === "diaria" ? finDia : periodo === "semanal" ? finSemana : finMes;
    return memberFiltro ? rows?.find(r => r.member_id === memberFiltro) ?? EMPTY_MEMBER
      : periodo === "diaria" ? resumoDia : periodo === "semanal" ? resumoSemana : resumoMes;
  }

  function progresso(papel: Papel, periodo: Periodo, metrica: string | null): number | null {
    if (!metrica) return null;
    if (["calls_marcadas","calls_realizadas","calls_recebidas","calls_noshow","calls_remarcadas"].includes(metrica)) return (callActivity(callPeriod(periodo,papel)) as Record<string,number>)[metrica] ?? 0;
    const financial = financeiroPeriodo(periodo, papel);
    if (["valor_coletado", "valor_recebido", "valor_pago", "caixa_gerado", "liquido"].includes(metrica)) return financial.liquido;
    if (["valor_vendido", "valor_venda", "bruto", "faturamento"].includes(metrica)) return financial.bruto;
    if (metrica === "vendas_fechadas") return financial.vendas;
    if (papel === "sdr") return sum(linhas("sdr", periodo), metrica);
    if (papel === "cs") return sum(linhas("cs", periodo), metrica);
    if (papel === "closer") {
      return sum(linhas("closer", periodo), metrica);
    }
    return null;
  }

  // Taxa de conversão semanal do closer (vendas fechadas / calls realizadas)
  const conversaoSemana = useMemo(() => {
    const rows = linhas("closer", "semanal");
    const calls = callPeriod("semanal","closer").realizadas;
    const vendas = financeiroPeriodo("semanal", "closer").vendas;
    return calls > 0 ? (vendas / calls) * 100 : 0;
  }, [dados, memberFiltro, finSemana, resumoSemana, callWeek]);

  function bonusDoGrupo(itens: MetaItem[], papel: Papel, periodo: Periodo) {
    if (papel === "sdr" && itens.some(m=>m.metrica === "calls_realizadas")) {
      const a=periodo=== "mensal" ? callMonth : callWeek;
      const b=a.bonus.find(b=>b.member_id===memberFiltro);
      return periodo==="mensal" ? b?.mensal_bonus ?? 0 : b?.bonus ?? 0;
    }
    // faixa_max: só a faixa mais alta atingida; soma: soma por cada ocorrência
    const grupos = new Map<string, MetaItem[]>();
    itens.forEach((m) => {
      const k = `${m.regra}|${m.grupo ?? m.metrica ?? m.label}`;
      grupos.set(k, [...(grupos.get(k) ?? []), m]);
    });
    let total = 0;
    grupos.forEach((lista) => {
      const atual = progresso(papel, periodo, lista[0].metrica) ?? 0;
      if (lista[0].regra === "soma") {
        const passo = N(lista[0].alvo) || 1;
        total += Math.floor(atual / passo) * N(lista[0].bonus);
      } else {
        const atingidas = lista.filter((m) => atual >= N(m.alvo));
        if (atingidas.length) total += Math.max(...atingidas.map((m) => N(m.bonus)));
      }
    });
    const teto = itens.map((m) => N(m.teto)).filter((t) => t > 0);
    if (teto.length) total = Math.min(total, Math.min(...teto));
    if (papel === "closer" && periodo === "semanal" && conversaoSemana > 30) total *= 2;
    return total;
  }

  const papeisVisiveis: Papel[] =
    !isSocio
      ? [papelPessoal]
      : papelSel === "todos"
        ? ["sdr", "closer", "cs"]
        : [papelSel as Papel];

  const membrosDoPapel = useMemo(
    () => membros.filter((m) => m.ativo && (m.role === papelSel || m.is_socio)),
    [membros, papelSel],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Metas e bonificação</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
            {isSocio
              ? "Vista de fundador: metas de todos os cargos, com progresso automático do CRM."
              : `As tuas metas de ${PAPEL_LABEL[papelPessoal]}, calculadas a partir do que já está registado no CRM.`}
          </p>
        </div>
        {isSocio && (
          <button className="eda-btn flex items-center gap-2" onClick={() => setEditar((v) => !v)}>
            <Pencil size={14} /> {editar ? "Fechar edição" : "Editar metas"}
          </button>
        )}
      </header>

      {/* Meta coletiva */}
      <section
        className="rounded-2xl p-6"
        style={{
          background: "linear-gradient(180deg, var(--surface3) 0%, rgba(13,26,46,0.5) 100%)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={16} style={{ color: "var(--gold)" }} />
          <h2 className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--text3)" }}>
            Meta do mês da equipa
          </h2>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="text-3xl font-bold">{eur(fatMes.bruto)}</div>
          <div className="text-sm" style={{ color: "var(--text2)" }}>
            de {eur(alvoColetivo)} · {Math.round(pctColetivo)}%
          </div>
        </div>
        <div className="mt-3">
          <Bar pct={pctColetivo} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span>Caixa: {eur(fatMes.liquido)}</span><span style={{ color: "var(--text2)" }}>de {eur(monthlyTargets?.liquido?.alvo ?? 0)}</span></div>
        <div className="mt-3"><Bar pct={Number(monthlyTargets?.liquido?.alvo ?? 0) > 0 ? fatMes.liquido / Number(monthlyTargets?.liquido?.alvo) * 100 : 0} /></div>
        <p className="text-xs mt-3" style={{ color: "var(--text3)" }}>
          Meta coletiva. Não paga bónus individual. Quando bater, o jantar da equipa é por conta da empresa.
        </p>
      </section>

      {isSocio && <EditorMetasMensais />}

      {/* Seletor de fundador */}
      {isSocio && (
        <div className="eda-card flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor="metas-papel">
              Cargo
            </label>
            <select
              id="metas-papel"
              className="eda-input"
              value={papelSel}
              onChange={(e) => {
                setPapelSel(e.target.value as Papel | "todos");
                setMembroSel("");
              }}
            >
              <option value="todos">Ver lado a lado</option>
              <option value="sdr">SDR</option>
              <option value="closer">Closer</option>
              <option value="cs">Customer Success</option>
            </select>
          </div>
          {papelSel !== "todos" && (
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor="metas-membro">
                Membro
              </label>
              <select
                id="metas-membro"
                className="eda-input"
                value={membroSel}
                onChange={(e) => setMembroSel(e.target.value)}
              >
                <option value="">Toda a equipa</option>
                {membrosDoPapel.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Tabelas por cargo */}
      <div className={papeisVisiveis.length > 1 ? "grid gap-6 xl:grid-cols-3" : "space-y-6"}>
        {papeisVisiveis.map((papel) => (
          <section key={papel} className="space-y-4">
            {papeisVisiveis.length > 1 && (
              <h2 className="text-sm uppercase tracking-wide font-semibold" style={{ color: "var(--text3)" }}>
                {PAPEL_LABEL[papel]}
              </h2>
            )}
            {(["diaria", "semanal", "mensal"] as Periodo[]).map((periodo) => {
              const itens = (metas ?? [])
                .filter((m) => m.papel === papel && m.periodo === periodo)
                .sort((a, b) => a.ordem - b.ordem);
              if (!itens.length) return null;
              const temBonus = itens.some((m) => m.tipo === "bonus");
              const bonusTotal = temBonus ? bonusDoGrupo(itens.filter((m) => m.tipo === "bonus"), papel, periodo) : 0;
              const notas = Array.from(new Set(itens.map((m) => m.nota).filter(Boolean))) as string[];

              return (
                <article key={periodo} className="eda-card">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--text3)" }}>
                      Meta {PERIODO_LABEL[periodo].toLowerCase()} {temBonus ? "(com bónus)" : "(sem bónus)"}
                    </h3>
                    {temBonus && (
                      <span className="text-sm font-bold" style={{ color: bonusTotal > 0 ? "var(--green)" : "var(--text3)" }}>
                        {eur(bonusTotal)}
                      </span>
                    )}
                  </div>

                  {papel === "closer" && periodo === "semanal" && conversaoSemana > 30 && (
                    <div
                      className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold px-2 py-1 rounded"
                      style={{ color: "var(--green)", border: "1px solid var(--green)" }}
                    >
                      <Sparkles size={12} /> Conversão acima de 30% — bónus em dobro ativado
                    </div>
                  )}

                  <div className="space-y-3">
                    {itens.map((m) => {
                      const atual = progresso(papel, periodo, m.metrica);
                      const alvo = N(m.alvo);
                      const pct = alvo > 0 && atual != null ? (atual / alvo) * 100 : 0;
                      return (
                        <div key={m.id}>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm">{m.label}</span>
                            <span className="text-sm font-semibold">
                              {atual != null ? `${fmtAtual(atual, m.unidade)} / ` : ""}
                              {fmtAlvo(m)}
                              {N(m.bonus) > 0 ? (
                                <span className="ml-2 text-xs" style={{ color: "var(--gold)" }}>
                                  {eur(N(m.bonus))}
                                </span>
                              ) : null}
                            </span>
                          </div>
                          {atual != null && alvo > 0 && (
                            <div className="mt-1">
                              <Bar pct={pct} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {notas.map((n) => (
                    <p key={n} className="text-xs mt-3" style={{ color: "var(--text3)" }}>
                      {n}
                    </p>
                  ))}
                </article>
              );
            })}
          </section>
        ))}
      </div>

      {/* Registo diário do CS */}
      {(profile?.role === "cs" || isSocio) && <CsDiario memberId={myMemberId} isSocio={isSocio} />}

      {/* Edição de metas (fundador) */}
      {isSocio && editar && <EditarMetas metas={metas ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ["metas_itens"] })} />}

      {/* Fechamento e datas */}
      <section className="eda-card">
        <div className="flex items-center gap-2 mb-2">
          <CalendarClock size={14} style={{ color: "var(--text3)" }} />
          <h2 className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--text3)" }}>
            Fechamento e datas
          </h2>
        </div>
        <ul className="text-xs space-y-1" style={{ color: "var(--text2)" }}>
          <li>A semana fecha no domingo. O bónus semanal é pago no mesmo dia, à noite. Se a meta for batida antes, o pagamento é no dia em que bateu.</li>
          <li>O bónus mensal é pago no último dia do mês.</li>
          <li>No dia 15 sai o parcial do mês.</li>
        </ul>
      </section>

      <footer className="eda-card">
        <h2 className="text-[11px] uppercase tracking-wide font-semibold mb-2" style={{ color: "var(--text3)" }}>
          Regras gerais
        </h2>
        <ul className="text-xs space-y-1" style={{ color: "var(--text2)" }}>
          <li>Só conta o que aconteceu de verdade: call realizada, venda paga, indicação agendada e paga.</li>
          <li>CRM atualizado é obrigatório. Sem isso, não há bónus na semana.</li>
          <li>Lead sem follow-up tira o bónus da semana.</li>
        </ul>
      </footer>
    </div>
  );
}

/** Registo diário do Customer Success (contactos ativos, PVE, indicações). */
function CsDiario({ memberId, isSocio }: { memberId?: string; isSocio: boolean }) {
  const qc = useQueryClient();
  const { todos: membros } = useMembrosDir();
  const [data, setData] = useState(todayISO());
  const [alvoMembro, setAlvoMembro] = useState(memberId ?? "");
  const membroAtivo = isSocio ? alvoMembro : (memberId ?? "");

  const { data: row } = useQuery({
    queryKey: ["cs_daily", membroAtivo, data],
    enabled: !!membroAtivo,
    queryFn: async () => {
      const { data: r, error } = await supabase
        .from("cs_daily" as never)
        .select("*")
        .eq("member_id", membroAtivo)
        .eq("data", data)
        .maybeSingle();
      if (error) throw error;
      return (r ?? null) as any;
    },
  });

  const campos: { k: string; label: string }[] = [
    { k: "contatos_ativos", label: "Contactos ativos" },
    { k: "abordagens_pve", label: "Abordagens PVE" },
    { k: "vendas_pve", label: "Vendas PVE" },
    { k: "vendas_indicacao", label: "Vendas por indicação" },
    { k: "onboardings_48h", label: "Onboardings até 48h" },
  ];

  const save = useMutation({
    mutationFn: async (patch: Record<string, number>) => {
      const { error } = await supabase
        .from("cs_daily" as never)
        .upsert({ member_id: membroAtivo, data, ...(row ?? {}), ...patch } as never, {
          onConflict: "member_id,data",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs_daily"] });
      qc.invalidateQueries({ queryKey: ["metas-progresso"] });
      toast.success("Dia guardado");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const membrosCs = membros.filter((m) => m.ativo && m.role === "cs");

  return (
    <section className="eda-card">
      <h2 className="text-[11px] uppercase tracking-wide font-semibold mb-3" style={{ color: "var(--text3)" }}>
        Registar dia — Customer Success
      </h2>
      <div className="flex flex-wrap gap-3 items-end">
        {isSocio && (
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor="cs-membro">
              Membro
            </label>
            <select id="cs-membro" className="eda-input" value={alvoMembro} onChange={(e) => setAlvoMembro(e.target.value)}>
              <option value="">Escolher…</option>
              {membrosCs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor="cs-data">
            Dia
          </label>
          <input id="cs-data" type="date" className="eda-input" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        {campos.map((c) => (
          <div key={c.k}>
            <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor={`cs-${c.k}`}>
              {c.label}
            </label>
            <input
              id={`cs-${c.k}`}
              type="number"
              min={0}
              className="eda-input w-28"
              disabled={!membroAtivo}
              defaultValue={N(row?.[c.k])}
              key={`${membroAtivo}-${data}-${c.k}-${N(row?.[c.k])}`}
              onBlur={(e) => {
                const v = Number(e.target.value) || 0;
                if (v !== N(row?.[c.k])) save.mutate({ [c.k]: v });
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Edição das metas (só fundador). Guarda no banco com histórico automático. */
function EditarMetas({ metas, onSaved }: { metas: MetaItem[]; onSaved: () => void }) {
  const [novo, setNovo] = useState(false);
  const [draft, setDraft] = useState({label:"",papel:"sdr",periodo:"mensal",alvo:"",bonus:"",unidade:"num"});
  const criar = useMutation({
    mutationFn: async () => {
      const alvo=Number(draft.alvo), bonus=Number(draft.bonus);
      if(!draft.label.trim() || draft.label.trim().length>200 || !draft.alvo || !Number.isFinite(alvo) || alvo<0 || !Number.isFinite(bonus) || bonus<0) throw new Error("Preenche o nome e valores válidos.");
      const {error}=await supabase.from("metas_itens").insert({label:draft.label.trim(),papel:draft.papel,periodo:draft.periodo,tipo:"bonus",unidade:draft.unidade,alvo,bonus,ativo:true});
      if(error)throw error;
    },
    onSuccess:()=>{setNovo(false);setDraft({label:"",papel:"sdr",periodo:"mensal",alvo:"",bonus:"",unidade:"num"});onSaved();toast.success("Meta criada");},
    onError:e=>toast.error(friendlyError(e)),
  });
  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, number> }) => {
      const { error } = await supabase.from("metas_itens" as never).update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meta atualizada");
      onSaved();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const { data: hist } = useQuery({
    queryKey: ["metas_itens_hist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metas_itens_hist" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <section className="eda-card space-y-4">
      <h2 className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "var(--text3)" }}>
        Editar metas
      </h2>
      <Button variant="outline" onClick={()=>setNovo(!novo)}>Adicionar item</Button>
      {novo && <form className="grid grid-cols-1 sm:grid-cols-3 gap-3" onSubmit={e=>{e.preventDefault();criar.mutate();}}>
        <label className="text-xs">Nome da meta<input aria-label="Nome da meta" required maxLength={200} className="eda-input" value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
        <label className="text-xs">Cargo<select aria-label="Cargo da meta" className="eda-input" value={draft.papel} onChange={e=>setDraft({...draft,papel:e.target.value})}>{["sdr","closer","cs"].map(p=><option key={p} value={p}>{PAPEL_LABEL[p as Papel]}</option>)}</select></label>
        <label className="text-xs">Período<select aria-label="Período da meta" className="eda-input" value={draft.periodo} onChange={e=>setDraft({...draft,periodo:e.target.value})}>{["diaria","semanal","mensal"].map(p=><option key={p} value={p}>{PERIODO_LABEL[p as Periodo]}</option>)}</select></label>
        <label className="text-xs">Alvo<input aria-label="Alvo da meta" className="eda-input" type="number" min="0" step="0.01" required value={draft.alvo} onChange={e=>setDraft({...draft,alvo:e.target.value})}/></label>
        <label className="text-xs">Unidade<select aria-label="Unidade da meta" className="eda-input" value={draft.unidade} onChange={e=>setDraft({...draft,unidade:e.target.value})}><option value="num">Número</option><option value="eur">EUR</option></select></label>
        <label className="text-xs">Bónus (EUR)<input aria-label="Bónus do novo item" className="eda-input" type="number" min="0" step="0.01" value={draft.bonus} onChange={e=>setDraft({...draft,bonus:e.target.value})}/></label>
        <Button type="submit" disabled={criar.isPending}>Criar item</Button>
        <Button type="button" variant="ghost" onClick={()=>setNovo(false)}>Cancelar</Button>
      </form>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--text3)" }} className="text-left text-[11px] uppercase">
              <th className="py-2 pr-3">Cargo</th>
              <th className="py-2 pr-3">Período</th>
              <th className="py-2 pr-3">Meta</th>
              <th className="py-2 pr-3">Número</th>
              <th className="py-2 pr-3">Bónus (€)</th>
            </tr>
          </thead>
          <tbody>
            {metas.map((m) => (
              <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2 pr-3">{PAPEL_LABEL[m.papel]}</td>
                <td className="py-2 pr-3">{PERIODO_LABEL[m.periodo]}</td>
                <td className="py-2 pr-3">{m.label}</td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    className="eda-input w-28"
                    aria-label={`Número da meta ${m.label}`}
                    defaultValue={m.alvo == null ? "" : String(N(m.alvo))}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== null && v !== N(m.alvo)) save.mutate({ id: m.id, patch: { alvo: v } });
                    }}
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    className="eda-input w-24"
                    aria-label={`Bónus da meta ${m.label}`}
                    defaultValue={N(m.bonus)}
                    onBlur={(e) => {
                      const v = Number(e.target.value) || 0;
                      if (v !== N(m.bonus)) save.mutate({ id: m.id, patch: { bonus: v } });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-[11px] uppercase tracking-wide font-semibold mb-2" style={{ color: "var(--text3)" }}>
          Histórico de alterações
        </h3>
        {(hist ?? []).length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text3)" }}>
            Ainda sem alterações registadas.
          </p>
        ) : (
          <ul className="text-xs space-y-1" style={{ color: "var(--text2)" }}>
            {(hist ?? []).map((h) => (
              <li key={h.id}>
                {new Date(h.created_at).toLocaleString("pt-PT")} · {h.actor_nome ?? "—"} ·{" "}
                {PAPEL_LABEL[h.papel as Papel] ?? h.papel} {h.label}: {h.alvo_antigo ?? "—"} → {h.alvo_novo ?? "—"}
                {N(h.bonus_novo) !== N(h.bonus_antigo) ? ` · bónus ${eur(N(h.bonus_antigo))} → ${eur(N(h.bonus_novo))}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
