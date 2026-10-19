import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rpc, useFunilPapel, useFunilRealtime, type Metrica } from "@/lib/funil";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { Avatar } from "@/components/Avatar";

export const Route = createFileRoute("/_authenticated/numeros")({ component: NumerosPage });

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
function periodo(k: string): [string, string] {
  const hoje = new Date();
  if (k === "hoje") return [iso(hoje), iso(hoje)];
  if (k === "semana") { const d = new Date(hoje); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), iso(hoje)]; }
  if (k === "30d") { const d = new Date(hoje); d.setDate(d.getDate() - 29); return [iso(d), iso(hoje)]; }
  return [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), iso(hoje)];
}
const PERIODOS = [["hoje", "Hoje"], ["semana", "Esta semana"], ["mes", "Este mês"], ["30d", "Últimos 30 dias"]] as const;

const CAMPOS: { k: keyof Metrica; l: string }[] = [
  { k: "ligacoes", l: "Ligações" }, { k: "mensagens", l: "Mensagens" }, { k: "contactos", l: "Contactos" },
  { k: "novos", l: "Leads novos" }, { k: "qualificados", l: "Qualificados" }, { k: "marcadas", l: "Calls marcadas" },
  { k: "realizadas", l: "Calls realizadas" }, { k: "noshows", l: "No-shows" }, { k: "followups", l: "Follow-ups" },
  { k: "sinais", l: "Sinais" }, { k: "vendas", l: "Vendas" },
];
const soma = (rows: Metrica[], k: keyof Metrica) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

function NumerosPage() {
  useFunilRealtime();
  const { isSocio, memberId } = useFunilPapel();
  const { mapa } = useEquipaFotos();
  const [per, setPer] = useState<string>("semana");
  const [pessoa, setPessoa] = useState<string>("");
  const [de, ate] = periodo(per);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["funil_metricas", de, ate, pessoa],
    queryFn: () => rpc<Metrica[]>("funil_metricas", { p_from: de, p_to: ate, p_member: pessoa || null }),
    refetchInterval: 30000,
  });

  const porPessoa = useMemo(() => {
    const m = new Map<string, Metrica[]>();
    rows.forEach((r) => m.set(r.member_id, [...(m.get(r.member_id) ?? []), r]));
    return [...m.entries()].map(([id, rs]) => ({ id, nome: rs[0].nome, role: rs[0].role, rs }));
  }, [rows]);

  const dias = useMemo(() => {
    const m = new Map<string, Metrica[]>();
    rows.forEach((r) => m.set(r.dia, [...(m.get(r.dia) ?? []), r]));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([dia, rs]) => ({ dia, rs }));
  }, [rows]);
  const maxDia = Math.max(1, ...dias.map((d) => soma(d.rs, "ligacoes") + soma(d.rs, "mensagens")));
  const pessoas = [...mapa.values()].filter((m) => ["sdr", "closer", "cs"].includes(m.role));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><div className="eda-eyebrow">{isSocio ? "Equipa" : "Desempenho"}</div><h1 className="text-2xl font-bold">{isSocio ? "Números da equipa" : "Os meus números"}</h1></div>
        {isSocio && (
          <select className="eda-input w-auto" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Toda a equipa</option>
            {pessoas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        )}
        <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
          {PERIODOS.map(([k, l]) => <button key={k} onClick={() => setPer(k)} className="px-3 py-1.5 text-xs font-semibold rounded-md" style={per === k ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text2)" }}>{l}</button>)}
        </div>
      </div>

      {isLoading ? <div className="text-sm" style={{ color: "var(--text2)" }}>A calcular…</div> : (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
            {CAMPOS.map((c) => (
              <div key={c.k} className="eda-kpi">
                <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text2)" }}>{c.l}</div>
                <div className="text-3xl font-bold mt-1">{soma(rows, c.k)}</div>
              </div>
            ))}
            <div className="eda-kpi"><div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text2)" }}>Qualificados ÷ contactos</div><div className="text-3xl font-bold mt-1">{pct(soma(rows, "qualificados"), soma(rows, "contactos"))}</div></div>
            <div className="eda-kpi"><div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text2)" }}>Vendas ÷ calls realizadas</div><div className="text-3xl font-bold mt-1">{pct(soma(rows, "vendas"), soma(rows, "realizadas"))}</div></div>
          </div>

          {isSocio && !pessoa && porPessoa.length > 0 && (
            <div className="eda-card p-0 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 820 }}>
                <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--text2)", background: "var(--surface2)" }}>
                  <th className="px-4 py-3">Pessoa</th>{CAMPOS.map((c) => <th key={c.k} className="px-3 py-3 text-right whitespace-nowrap">{c.l}</th>)}
                </tr></thead>
                <tbody>
                  {porPessoa.map((p) => (
                    <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Avatar nome={p.nome} foto={mapa.get(p.id)?.foto_url} size={26} /><div><div className="font-semibold">{p.nome}</div><div className="text-[11px] uppercase" style={{ color: "var(--text3)" }}>{p.role}</div></div></div></td>
                      {CAMPOS.map((c) => <td key={c.k} className="px-3 text-right tabular-nums">{soma(p.rs, c.k)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="eda-card">
            <div className="flex items-baseline justify-between mb-3"><h2 className="font-bold">Dia a dia</h2><span className="text-xs" style={{ color: "var(--text2)" }}>Barra = ligações + mensagens</span></div>
            {dias.length === 0 ? <div className="text-sm py-6 text-center" style={{ color: "var(--text3)" }}>Ainda sem atividade neste período. Os números aparecem sozinhos assim que mexeres nos cartões do funil.</div> : (
              <div className="space-y-2">
                {dias.map(({ dia, rs }) => {
                  const toques = soma(rs, "ligacoes") + soma(rs, "mensagens");
                  return (
                    <div key={dia} className="grid items-center gap-3" style={{ gridTemplateColumns: "92px 1fr 280px" }}>
                      <div className="text-xs capitalize" style={{ color: "var(--text2)" }}>{new Date(dia + "T12:00:00").toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" })}</div>
                      <div className="h-3 rounded-full" style={{ background: "var(--surface2)" }}><div className="h-3 rounded-full" style={{ width: `${(toques / maxDia) * 100}%`, background: "var(--accent)" }} /></div>
                      <div className="text-xs tabular-nums" style={{ color: "var(--text2)" }}>{soma(rs, "ligacoes")} lig · {soma(rs, "mensagens")} msg · {soma(rs, "marcadas")} marc · {soma(rs, "realizadas")} real · {soma(rs, "vendas")} vendas</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {!isSocio && !memberId && <div className="text-xs" style={{ color: "var(--gold)" }}>A tua conta ainda não está ligada a um membro da equipa. Fala com o Pablo.</div>}
        </>
      )}
    </div>
  );
}
