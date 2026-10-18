import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/sinais")({
  component: SinaisPage,
});

type Row = {
  key: string;
  aberto: boolean;
  nome: string;
  produto: string | null;
  dataSinal: string | null;
  closerId: string | null;
  sdrId: string | null;
  sinal: number;
  total: number | null;
  prevista: string | null;
  resultado: "aberto" | "fechado" | "cancelado";
  fechadoEm: string | null;
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function diasEntre(aISO: string, bISO: string) {
  const a = new Date(aISO + "T00:00:00").getTime();
  const b = new Date(bISO + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

function SinaisPage() {
  const hoje = new Date().toLocaleDateString("sv-SE");
  const [mes, setMes] = useState("todos");
  const [estado, setEstado] = useState("todos");
  const [closer, setCloser] = useState("todos");

  const { data: members } = useQuery({
    queryKey: ["members-directory-all"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return (data ?? []) as { id: string; nome: string; role: string; ativo: boolean }[];
    },
  });
  const nomes = useMemo(() => Object.fromEntries((members ?? []).map((m) => [m.id, m.nome])), [members]);

  const { data: abertos, isLoading: l1 } = useQuery({
    queryKey: ["sinais", "abertos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendas").select("*").eq("is_sinal", true).order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: hist, isLoading: l2 } = useQuery({
    queryKey: ["sinais", "hist"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendas_sinal_hist").select("*").order("fechado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows: Row[] = useMemo(() => {
    const a: Row[] = (abertos ?? []).map((v) => ({
      key: "a" + v.id,
      aberto: true,
      nome: v.nome_cliente,
      produto: v.produto,
      dataSinal: v.data,
      closerId: v.closer_id,
      sdrId: v.sdr_id,
      sinal: Number(v.ticket) || 0,
      total: v.valor_total_previsto == null ? null : Number(v.valor_total_previsto),
      prevista: v.data_prevista_fecho,
      resultado: "aberto",
      fechadoEm: null,
    }));
    const h: Row[] = (hist ?? []).map((v) => ({
      key: "h" + v.id,
      aberto: false,
      nome: v.nome_cliente,
      produto: v.produto,
      dataSinal: v.data_sinal,
      closerId: v.closer_id,
      sdrId: v.sdr_id,
      sinal: Number(v.sinal_recebido) || 0,
      total: v.valor_total_previsto == null ? null : Number(v.valor_total_previsto),
      prevista: v.data_prevista_fecho,
      resultado: v.resultado,
      fechadoEm: v.fechado_em,
    }));
    return [...a, ...h].sort((x, y) => (y.dataSinal ?? "").localeCompare(x.dataSinal ?? ""));
  }, [abertos, hist]);

  const estadoDe = (r: Row) => {
    if (r.resultado === "fechado") return { k: "fechado", t: `Fechado em ${fmtDate(r.fechadoEm!)}`, cor: "var(--green)" };
    if (r.resultado === "cancelado") return { k: "cancelado", t: `Cancelado em ${fmtDate(r.fechadoEm!)}`, cor: "var(--red)" };
    if (!r.prevista) return { k: "semdata", t: "Sem data", cor: "var(--text3)" };
    const d = diasEntre(r.prevista, hoje);
    if (d > 0) return { k: "atrasado", t: `Atrasado ${d} ${d === 1 ? "dia" : "dias"}`, cor: "var(--red)" };
    return { k: "aberto", t: d === 0 ? "Fecha hoje" : `Em aberto · faltam ${-d} ${-d === 1 ? "dia" : "dias"}`, cor: "var(--gold)" };
  };

  const mesesDisponiveis = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.dataSinal && s.add(r.dataSinal.slice(0, 7)));
    return [...s].sort().reverse();
  }, [rows]);
  const closersDisponiveis = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.closerId && s.add(r.closerId));
    return [...s];
  }, [rows]);

  const filtradas = useMemo(
    () =>
      rows.filter((r) => {
        if (mes !== "todos" && r.dataSinal?.slice(0, 7) !== mes) return false;
        if (closer !== "todos" && r.closerId !== closer) return false;
        if (estado !== "todos" && estadoDe(r).k !== estado) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mes, closer, estado, hoje],
  );

  const abertosTodos = rows.filter((r) => r.aberto);
  const totalSinal = abertosTodos.reduce((s, r) => s + r.sinal, 0);
  const totalAFechar = abertosTodos.reduce((s, r) => s + (r.total ?? 0), 0);
  const atrasados = abertosTodos.filter((r) => estadoDe(r).k === "atrasado").length;

  const mesLabel = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const loading = l1 || l2;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sinais</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          Todos os sinais de todos os meses e quando era suposto fechar. Para fechar um sinal, use a conversão em{" "}
          <Link to="/vendas" className="underline" style={{ color: "var(--accent)" }}>Registar venda</Link>.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="eda-kpi">
          <div className="text-xs" style={{ color: "var(--text2)" }}>Sinais em aberto</div>
          <div>{abertosTodos.length}</div>
        </div>
        <div className="eda-kpi">
          <div className="text-xs" style={{ color: "var(--text2)" }}>Sinal recebido</div>
          <div>{eur(totalSinal)}</div>
        </div>
        <div className="eda-kpi">
          <div className="text-xs" style={{ color: "var(--text2)" }}>Valor a fechar</div>
          <div>{eur(totalAFechar)}</div>
        </div>
        <div className="eda-kpi">
          <div className="text-xs" style={{ color: "var(--text2)" }}>Atrasados</div>
          <div style={{ color: atrasados ? "var(--red)" : undefined }}>{atrasados}</div>
        </div>
      </div>

      <div className="eda-card">
        <div className="flex flex-wrap gap-3 mb-4">
          <select className="eda-input" style={{ width: "auto" }} value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês do sinal">
            <option value="todos">Todos os meses</option>
            {mesesDisponiveis.map((m) => (
              <option key={m} value={m}>{mesLabel(m)}</option>
            ))}
          </select>
          <select className="eda-input" style={{ width: "auto" }} value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
            <option value="todos">Todos os estados</option>
            <option value="aberto">Em aberto</option>
            <option value="atrasado">Atrasado</option>
            <option value="semdata">Sem data</option>
            <option value="fechado">Fechado</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <select className="eda-input" style={{ width: "auto" }} value={closer} onChange={(e) => setCloser(e.target.value)} aria-label="Closer">
            <option value="todos">Todos os closers</option>
            {closersDisponiveis.map((id) => (
              <option key={id} value={id}>{nomes[id] ?? "—"}</option>
            ))}
          </select>
          <span className="text-xs self-center" style={{ color: "var(--text3)" }}>{filtradas.length} sinais</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase">
                <th className="py-2">Sinal em</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Closer</th>
                <th>SDR</th>
                <th className="text-right">Sinal</th>
                <th className="text-right">Total previsto</th>
                <th>Fecho previsto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => {
                const e = estadoDe(r);
                return (
                  <tr key={r.key}>
                    <td className="py-2.5 whitespace-nowrap">{r.dataSinal ? fmtDate(r.dataSinal) : "—"}</td>
                    <td>{r.nome}</td>
                    <td style={{ color: "var(--text2)" }}>{r.produto || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{(r.closerId && nomes[r.closerId]) || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{(r.sdrId && nomes[r.sdrId]) || "—"}</td>
                    <td className="text-right font-semibold" style={{ color: "var(--gold)" }}>{eur(r.sinal)}</td>
                    <td className="text-right">{r.total == null ? "—" : eur(r.total)}</td>
                    <td className="whitespace-nowrap">{r.prevista ? fmtDate(r.prevista) : <span style={{ color: "var(--text3)" }}>—</span>}</td>
                    <td className="whitespace-nowrap font-semibold" style={{ color: e.cor }}>{e.t}</td>
                  </tr>
                );
              })}
              {!loading && filtradas.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center" style={{ color: "var(--text3)" }}>Sem sinais para este filtro.</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={9} className="py-6 text-center" style={{ color: "var(--text3)" }}>A carregar…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs mt-4" style={{ color: "var(--text3)" }}>
          Sinais não entram no bruto nem no líquido até fecharem. Fechos e cancelamentos ficam registados a partir de 18/10/2026.
        </p>
      </div>
    </div>
  );
}
