import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Feedback, Sinal } from "@/lib/feedback-operacional";

// Período anterior com o mesmo número de dias, imediatamente antes de `from`.
export function periodoAnterior(from: string, to: string) {
  const f = new Date(from + "T12:00:00Z");
  const t = new Date(to + "T12:00:00Z");
  const dias = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const pTo = new Date(f); pTo.setUTCDate(pTo.getUTCDate() - 1);
  const pFrom = new Date(pTo); pFrom.setUTCDate(pFrom.getUTCDate() - (dias - 1));
  return { pFrom: pFrom.toISOString().slice(0, 10), pTo: pTo.toISOString().slice(0, 10) };
}

export function usePrevDaily(tabela: "sdr_daily" | "closer_daily", member: string | undefined, from: string, to: string) {
  const { pFrom, pTo } = periodoAnterior(from, to);
  return useQuery({
    queryKey: [tabela, "prev", member, pFrom, pTo],
    enabled: !!member,
    queryFn: async () => {
      let q = (supabase as any).from(tabela).select("*").gte("data", pFrom).lte("data", pTo);
      if (member && member !== "all") q = q.eq("member_id", member);
      const { data } = await q;
      return (data ?? []) as any[];
    },
  }).data ?? [];
}

const COR: Record<string, string> = {
  excelente: "var(--green)", saudavel: "var(--green)", atencao: "var(--gold)", critico: "var(--red, #ef4444)",
};

export function FeedbackOperacional({ fb, chave, isAll }: { fb: Feedback; chave: string; isAll: boolean }) {
  const [resposta, setResposta] = useState<Record<string, "sim" | "nao">>({});
  const [aberto, setAberto] = useState(false);
  const r = resposta[chave];

  const notaCor = fb.nota >= 7.5 ? "var(--green)" : fb.nota >= 5 ? "var(--gold)" : "var(--red, #ef4444)";

  return (
    <section className="eda-card space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs uppercase font-semibold tracking-wider" style={{ color: "var(--text2)" }}>
          Feedback operacional
        </div>
        {r === "sim" && !fb.semDados && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: notaCor }}>{fb.nota.toFixed(1).replace(".", ",")}</span>
            <span className="text-sm" style={{ color: "var(--text3)" }}>/10</span>
            {fb.provisoria && <span className="text-[11px]" style={{ color: "var(--text3)" }}>Nota provisória: ainda há pouca amostra</span>}
          </div>
        )}
      </div>

      {isAll && (
        <p className="text-xs" style={{ color: "var(--text3)" }}>
          A ver a soma de todos. Escolhe uma pessoa no filtro para um diagnóstico individual.
        </p>
      )}

      {fb.semDados ? (
        <p className="text-sm" style={{ color: "var(--text2)" }}>Ainda não há registos neste período para gerar um diagnóstico.</p>
      ) : !r ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Os teus registos estão atualizados?</span>
          <button className="eda-btn" onClick={() => setResposta({ ...resposta, [chave]: "sim" })}>Sim, estão atualizados</button>
          <button className="eda-btn-ghost" onClick={() => setResposta({ ...resposta, [chave]: "nao" })}>Preciso atualizar</button>
        </div>
      ) : r === "nao" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm" style={{ color: "var(--text2)" }}>
            Atualiza os teus números no registo diário acima e depois volta aqui para gerar um diagnóstico confiável.
          </p>
          <button className="eda-btn-ghost" onClick={() => setResposta({ ...resposta, [chave]: "sim" })}>Já atualizei</button>
        </div>
      ) : (
        <div className="space-y-3">
          {fb.divergencias.length > 0 && (
            <div className="rounded-md p-3 text-sm" style={{ border: "1px solid var(--gold)", color: "var(--text)" }}>
              <div className="font-semibold mb-1" style={{ color: "var(--gold)" }}>Confere os teus registos</div>
              {fb.divergencias.map((d) => <div key={d}>{d}</div>)}
              {fb.gargalo && <div className="mt-2" style={{ color: "var(--text2)" }}>Se os dados estiverem corretos, o principal ponto de atenção seria o indicado abaixo.</div>}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-7 space-y-2">
              <Linha label="Principal gargalo" valor={fb.gargalo?.titulo ?? "Sem gargalo relevante"} cor={fb.gargalo ? COR[fb.gargalo.nivel] : "var(--green)"} forte />
              {fb.gargalo && <Linha label="Evidência" valor={fb.gargalo.evidencia} />}
              {fb.gargalo && <Linha label="Ação" valor={fb.gargalo.acao} />}
            </div>
            <div className="md:col-span-5 space-y-2">
              <Linha label="Ponto forte" valor={fb.pontoForte ?? "Ainda sem ponto forte claro neste período."} cor="var(--green)" />
              <Linha label="Ponto de atenção" valor={fb.atencao ? `${fb.atencao.titulo}. ${fb.atencao.evidencia}` : "Nada mais a assinalar."} cor={fb.atencao ? "var(--gold)" : undefined} />
            </div>
          </div>

          <button className="text-xs underline" style={{ color: "var(--text2)" }} onClick={() => setAberto(!aberto)}>
            {aberto ? "Esconder análise completa" : "Ver análise completa"}
          </button>
          {aberto && (
            <div className="space-y-1">
              {fb.detalhes.filter((d) => d.evidencia).map((d: Sinal) => (
                <div key={d.id} className="flex gap-2 text-xs">
                  <span className="inline-block w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: COR[d.nivel] }} />
                  <span style={{ color: "var(--text2)" }}>{d.evidencia}{d.amostraOk ? "" : " (amostra pequena)"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Linha({ label, valor, cor, forte }: { label: string; valor: string; cor?: string; forte?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase font-semibold" style={{ color: "var(--text3)" }}>{label}</div>
      <div className={forte ? "text-base font-semibold" : "text-sm"} style={cor ? { color: cor } : undefined}>{valor}</div>
    </div>
  );
}
