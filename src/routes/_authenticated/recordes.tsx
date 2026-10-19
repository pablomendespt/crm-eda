import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { supabase } from "@/integrations/supabase/client";

type Recorde = { valor?: number | string | null; data?: string | null; nome?: string | null; member_id?: string | null; extra?: number | string | null };
type RecordesPayload = Partial<Record<RecordeKey, Recorde>>;
type RecordeKey = typeof DEFINICOES[number]["key"];

type LinhaRanking = {
  member_id: string; nome: string; role: string; foto_url: string | null;
  closer_vendas: number; closer_valor: number | string; closer_calls: number;
  sdr_vendas: number; sdr_marcadas: number; sdr_realizadas: number;
};

/** Só os recordes que mexem com a operação: dinheiro que entra e o que o SDR gera. */
const DEFINICOES = [
  { key: "closer_melhor_mes", titulo: "Melhor mês de um closer", kind: "euro", extra: "vendas", grupo: "closer" },
  { key: "closer_vendas_mes", titulo: "Mais vendas de um closer num mês", kind: "vendas", extra: "euro", grupo: "closer" },
  { key: "closer_caixa_mes", titulo: "Mais dinheiro recebido num mês", kind: "euro", grupo: "closer" },
  { key: "sdr_vendas_mes", titulo: "Mais vendas geradas por um SDR num mês", kind: "vendas", extra: "euro", grupo: "sdr" },
  { key: "sdr_marcadas_mes", titulo: "Mais calls marcadas num mês", kind: "calls", grupo: "sdr" },
] as const;

export const Route = createFileRoute("/_authenticated/recordes")({
  component: Recordes,
});

function numero(valor: number | string | null | undefined) { return Number(valor ?? 0); }
function euros(valor: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: numero(valor) % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(numero(valor));
}
function dataLabel(data?: string | null) {
  if (!data) return "";
  const [y, m, d] = data.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (d === 1) return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(dt);
  return new Intl.DateTimeFormat("pt-PT").format(dt);
}
function valorLabel(kind: string, valor?: number | string | null) {
  if (kind === "euro") return euros(valor);
  return `${numero(valor).toLocaleString("pt-PT")} ${kind}`;
}
function extraLabel(kind: string | undefined, extra?: number | string | null) {
  if (extra == null || extra === "") return "";
  return kind === "euro" ? euros(extra) : `${numero(extra).toLocaleString("pt-PT")} vendas`;
}
function iniciais(nome: string) { return nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join(""); }
function plural(n: number, um: string, varios: string) { return `${n.toLocaleString("pt-PT")} ${n === 1 ? um : varios}`; }

/* ---------- Ranking do mês ---------- */
function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function moverMes(mes: string, delta: number) {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function mesLabel(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}
function fimDoMes(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m, 0);
  return `${mes}-${String(d.getDate()).padStart(2, "0")}`;
}

type Posicao = { id: string; nome: string; foto: string | null; principal: string; detalhe: string };

function Pódio({ titulo, criterio, posicoes, vazio }: { titulo: string; criterio: string; posicoes: Posicao[]; vazio: string }) {
  const linhas: (Posicao | null)[] = [0, 1, 2].map((i) => posicoes[i] ?? null);
  return (
    <section className="eda-card rank-card">
      <header className="mb-4">
        <h2 className="text-lg font-bold">{titulo}</h2>
        <p className="mt-0.5 text-xs text-text2">{criterio}</p>
      </header>
      <ol className="flex flex-col gap-2.5">
        {linhas.map((p, i) => (
          <li key={i} className={`rank-row rank-row-${i + 1} ${p ? "" : "rank-row-vazio"}`}>
            <span className={`rank-medal rank-medal-${i + 1}`} aria-label={`${i + 1}º lugar`}>{i + 1}º</span>
            {p ? (
              <>
                {p.foto ? <img src={p.foto} alt="" className="rank-avatar" /> : <span className="rank-avatar rank-avatar-ini" aria-hidden="true">{iniciais(p.nome)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.nome}</div>
                  <div className="truncate text-xs text-text2">{p.detalhe}</div>
                </div>
                <div className="rank-valor">{p.principal}</div>
              </>
            ) : (
              <div className="flex-1 text-sm text-text3">{i === 0 && posicoes.length === 0 ? vazio : "—"}</div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function RankingDoMes() {
  const [mes, setMes] = useState(mesAtual());
  const { data, isLoading, error } = useQuery({
    queryKey: ["crm2-ranking-mes", mes],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("crm2_ranking_mes", { p_from: `${mes}-01`, p_to: fimDoMes(mes) });
      if (error) throw error;
      return (data ?? []) as LinhaRanking[];
    },
  });
  const linhas = data ?? [];

  const closers: Posicao[] = linhas
    .filter((l) => l.role === "closer" && numero(l.closer_valor) > 0)
    .sort((a, b) => numero(b.closer_valor) - numero(a.closer_valor) || b.closer_vendas - a.closer_vendas)
    .slice(0, 3)
    .map((l) => ({
      id: l.member_id, nome: l.nome, foto: l.foto_url,
      principal: euros(l.closer_valor),
      detalhe: [plural(l.closer_vendas, "venda", "vendas"), l.closer_calls > 0 ? plural(numero(l.closer_calls), "call realizada", "calls realizadas") : ""].filter(Boolean).join(" · "),
    }));

  const sdrs: Posicao[] = linhas
    .filter((l) => l.role === "sdr" && (l.sdr_vendas > 0 || numero(l.sdr_marcadas) > 0))
    .sort((a, b) => b.sdr_vendas - a.sdr_vendas || numero(b.sdr_realizadas) - numero(a.sdr_realizadas) || numero(b.sdr_marcadas) - numero(a.sdr_marcadas))
    .slice(0, 3)
    .map((l) => ({
      id: l.member_id, nome: l.nome, foto: l.foto_url,
      principal: plural(l.sdr_vendas, "venda", "vendas"),
      detalhe: `${numero(l.sdr_marcadas).toLocaleString("pt-PT")} marcadas · ${numero(l.sdr_realizadas).toLocaleString("pt-PT")} realizadas`,
    }));

  const noAtual = mes === mesAtual();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Ranking do mês</h2>
        <div className="flex items-center gap-1.5">
          <button type="button" className="rank-nav" onClick={() => setMes(moverMes(mes, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-[9.5rem] text-center text-sm font-semibold capitalize">{mesLabel(mes)}</span>
          <button type="button" className="rank-nav" onClick={() => setMes(moverMes(mes, 1))} disabled={noAtual} aria-label="Mês seguinte"><ChevronRight size={16} /></button>
        </div>
      </div>
      {error && <div className="eda-card text-sm text-red">Não foi possível carregar o ranking.</div>}
      <div className={`grid gap-5 lg:grid-cols-2 ${isLoading ? "opacity-60" : ""}`}>
        <Pódio titulo="Closers" criterio="Por faturação bruta do mês" posicoes={closers} vazio="Ainda sem vendas neste mês." />
        <Pódio titulo="SDRs" criterio="Por vendas das calls que marcaram" posicoes={sdrs} vazio="Ainda sem resultados neste mês." />
      </div>
    </div>
  );
}

/* ---------- Recordes ---------- */
function CartaoRecorde({ def, recorde, mapa }: { def: typeof DEFINICOES[number]; recorde: Recorde; mapa: ReturnType<typeof useEquipaFotos>["mapa"] }) {
  const member = recorde.member_id ? mapa.get(recorde.member_id) : undefined;
  const nome = recorde.nome || member?.nome || "—";
  const foto = member?.foto_url;
  const extra = extraLabel("extra" in def ? def.extra : undefined, recorde.extra);
  return (
    <article className="record-card group">
      {foto ? <img src={foto} alt={`Fotografia de ${nome}`} className="record-photo" /> : <div className="record-initials" aria-hidden="true">{iniciais(nome)}</div>}
      <div className="record-overlay" />
      <div className="record-pill"><Trophy size={13} /> Recorde</div>
      <div className="record-content">
        <div className="record-value">{valorLabel(def.kind, recorde.valor)}</div>
        <h2>{def.titulo}</h2>
        <p><strong>{nome}</strong>{dataLabel(recorde.data) ? ` · ${dataLabel(recorde.data)}` : ""}{extra ? ` · ${extra}` : ""}</p>
      </div>
    </article>
  );
}

function Recordes() {
  const { mapa } = useEquipaFotos();
  const { data, isLoading, error } = useQuery({
    queryKey: ["crm2-recordes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("crm2_recordes");
      if (error) throw error;
      return (data ?? {}) as RecordesPayload;
    },
  });
  const cards = DEFINICOES.flatMap((def) => data?.[def.key] ? [{ def, recorde: data[def.key] as Recorde }] : []);
  const closers = cards.filter((c) => c.def.grupo === "closer");
  const sdrs = cards.filter((c) => c.def.grupo === "sdr");

  return (
    <div className="space-y-9">
      <header className="max-w-3xl">
        <p className="eda-eyebrow">Hall da equipa</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Ranking e recordes</h1>
        <p className="mt-2 text-sm leading-6 text-text2">O ranking mostra quem está à frente este mês. Os recordes são os números a bater: atualizam sozinhos com as vendas e os registos do dia, e quem bater primeiro fica com o recorde.</p>
      </header>

      <RankingDoMes />

      <div className="space-y-4">
        <h2 className="text-xl font-bold">Recordes a bater</h2>
        {isLoading && <div className="eda-card text-sm text-text2">A carregar recordes...</div>}
        {error && <div className="eda-card text-sm text-red">Não foi possível carregar os recordes.</div>}
        {!isLoading && !error && cards.length === 0 && <div className="eda-card text-sm text-text2">Os primeiros recordes aparecem assim que houver dados.</div>}
        {closers.length > 0 && (
          <div className="space-y-3">
            <h3 className="eda-eyebrow">Closers</h3>
            <div className="record-grid">{closers.map(({ def, recorde }) => <CartaoRecorde key={def.key} def={def} recorde={recorde} mapa={mapa} />)}</div>
          </div>
        )}
        {sdrs.length > 0 && (
          <div className="space-y-3 pt-3">
            <h3 className="eda-eyebrow">SDRs</h3>
            <div className="record-grid">{sdrs.map(({ def, recorde }) => <CartaoRecorde key={def.key} def={def} recorde={recorde} mapa={mapa} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
