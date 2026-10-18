import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { supabase } from "@/integrations/supabase/client";

type Recorde = { valor?: number | string | null; data?: string | null; nome?: string | null; member_id?: string | null; extra?: number | string | null };
type RecordesPayload = Partial<Record<RecordeKey, Recorde>>;
type RecordeKey = typeof DEFINICOES[number]["key"];

const DEFINICOES = [
  { key: "maior_venda", titulo: "Maior venda individual", kind: "euro" },
  { key: "closer_melhor_mes", titulo: "Melhor mês de um closer", kind: "euro", extra: "vendas" },
  { key: "closer_vendas_mes", titulo: "Mais vendas de um closer num mês", kind: "vendas", extra: "euro" },
  { key: "closer_maior_dia", titulo: "Maior faturamento de um closer num dia", kind: "euro", extra: "vendas" },
  { key: "closer_vendas_dia", titulo: "Mais vendas de um closer num dia", kind: "vendas", extra: "euro" },
  { key: "closer_caixa_mes", titulo: "Mais dinheiro recebido num mês", kind: "euro" },
  { key: "closer_sinais_mes", titulo: "Mais sinais num mês", kind: "sinais" },
  { key: "closer_calls_dia", titulo: "Mais calls realizadas num dia (Closer)", kind: "calls" },
  { key: "sdr_vendas_mes", titulo: "Mais vendas agendadas por um SDR num mês", kind: "vendas", extra: "euro" },
  { key: "sdr_marcadas_dia", titulo: "Mais calls marcadas num dia", kind: "calls" },
  { key: "sdr_marcadas_mes", titulo: "Mais calls marcadas num mês", kind: "calls" },
  { key: "sdr_realizadas_dia", titulo: "Mais calls realizadas num dia (SDR)", kind: "calls" },
  { key: "sdr_ligacoes_dia", titulo: "Mais ligações num dia", kind: "ligações" },
  { key: "sdr_conversas_dia", titulo: "Mais conversas iniciadas num dia", kind: "conversas" },
  { key: "sdr_qualificados_dia", titulo: "Mais leads qualificados num dia", kind: "leads" },
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
  const leandroId = "0b81c9f9-22b8-4a7d-914c-ec5d212b5b4c";
  const cards = DEFINICOES.flatMap((def) => data?.[def.key] ? [{ def, recorde: data[def.key] as Recorde }] : []);

  return (
    <div className="space-y-7">
      <header className="max-w-3xl">
        <p className="eda-eyebrow">Hall da equipa</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Recordes individuais</h1>
        <p className="mt-2 text-sm leading-6 text-text2">Atualizam sozinhos com as vendas e os registos do dia. Quem bater primeiro fica com o recorde.</p>
      </header>
      {isLoading && <div className="eda-card text-sm text-text2">A carregar recordes...</div>}
      {error && <div className="eda-card text-sm text-red">Não foi possível carregar os recordes.</div>}
      {!isLoading && !error && cards.length === 0 && <div className="eda-card text-sm text-text2">Os primeiros recordes aparecem assim que houver dados.</div>}
      <div className="record-grid">
        {cards.map(({ def, recorde }, index) => {
          const member = recorde.member_id ? mapa.get(recorde.member_id) : undefined;
          const nome = recorde.nome || member?.nome || "—";
          const foto = member?.foto_url;
          const extra = extraLabel("extra" in def ? def.extra : undefined, recorde.extra);
          return (
            <article key={def.key} className={`record-card group ${index === 0 ? "record-card-featured" : ""}`}>
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
        })}
        {(() => {
          const m = mapa.get(leandroId);
          return (
            <article className="record-card group">
              {m?.foto_url ? <img src={m.foto_url} alt="Fotografia de Leandro" className="record-photo" /> : <div className="record-initials" aria-hidden="true">L</div>}
              <div className="record-overlay" />
              <div className="record-pill"><Trophy size={13} /> Recorde</div>
              <div className="record-content">
                <div className="record-value" style={{ fontSize: 30 }}>Venda por PDF</div>
                <h2>Venda mais aleatória</h2>
                <p><strong>Leandro</strong> · fechou com um PDF feito no Claude na hora</p>
              </div>
            </article>
          );
        })()}
      </div>
    </div>
  );
}
