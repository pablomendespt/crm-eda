import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/rls-error";
import { eur, todayISO } from "@/lib/format";
import { useMembrosDir } from "@/lib/membros";
import { financeRpc } from "@/lib/finance-reporting";


export const Route = createFileRoute("/_authenticated/registro-vendas")({
  component: RegistoVendas,
});

type Estado = "cancelado" | "pago_integral" | "recorrente" | "sem_estado";

type Row = {
  id: string;
  data: string;
  nome: string;
  email: string | null;
  tel: string | null;
  closer_nome: string | null;
  sdr_nome: string | null;
  valor: number;
  pago: number;
  forma_pagamento: string | null;
  parcelas: number | null;
  tipo_venda: string | null;
  link_gravacao: string | null;
  estado: Estado;
  produto: string;
  venda_id: string | null;
};

const PRODUTOS = [["eda", "EDA", "Europa Digital Academy"], ["pve", "PVE", "PVE"], ["todos", "Todos", null]] as const;

const ESTADO_LABEL: Record<Estado, string> = {
  cancelado: "Cancelado",
  pago_integral: "Pago Integral",
  recorrente: "Em Recorrente",
  sem_estado: "Sem estado",
};

const ESTADO_COLOR: Record<Estado, string> = {
  cancelado: "var(--red)",
  pago_integral: "var(--green)",
  recorrente: "var(--accent)",
  sem_estado: "var(--text)",
};

const ESTADO_SWATCH: Record<Estado, string> = {
  cancelado: "var(--red)",
  pago_integral: "var(--green)",
  recorrente: "var(--accent)",
  sem_estado: "transparent",
};

const ESTADOS: Estado[] = ["pago_integral", "recorrente", "cancelado", "sem_estado"];

/** Verde = à vista ou Klarna · Azul = parcelado/recorrente. Vermelho é sempre manual. */
function estadoAuto(forma: string | null, parcelas: number | null): Estado {
  const f = (forma ?? "").toLowerCase();
  if (f.includes("klarna") || f.includes("vista")) return "pago_integral";
  if ((parcelas ?? 1) > 1 || f.includes("recorrente") || f.includes("parcelad")) return "recorrente";
  return "pago_integral";
}

const FORMAS = ["Cartão - À Vista", "Cartão - Parcelado", "Klarna", "Pagamento Recorrente", "MB Way", "Dinheiro"];
const TIPOS = ["Via Closer", "Venda Direta", "Direta | Presencial"];

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function RegistoVendas() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const isSocio = profile?.role === "socio";

  const [busca, setBusca] = useState("");
  const [prodKey, setProdKey] = useState<(typeof PRODUTOS)[number][0]>("eda");
  const produto = PRODUTOS.find((p) => p[0] === prodKey)?.[2] ?? "Europa Digital Academy";
  const { data: totais } = useQuery({ queryKey: ["registo-vendas-hist", "totais", produto],
    queryFn: () => financeRpc<{ mes: string; vendas: number; valor: number; pago: number }[]>("registo_vendas_totais", { p_produto: produto }) });
  const monthlyFinancial = new Map((totais ?? []).map(r => [r.mes, r]));

  const { closers: closersDir, sdrs: sdrsDir } = useMembrosDir();
  const nomesCloser = useMemo(() => closersDir.map((m) => m.nome), [closersDir]);
  const nomesSdr = useMemo(() => sdrsDir.map((m) => m.nome), [sdrsDir]);



  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["registo-vendas-hist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registo_vendas_hist")
        .select("*")
        .order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const patch = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: keyof Row; valor: unknown }) => {
      const { error } = await supabase
        .from("registo_vendas_hist")
        .update({ [campo]: valor } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registo-vendas-hist"] }),
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const addRow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("registo_vendas_hist")
        .insert({ data: todayISO(), nome: "" } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Linha adicionada.");
      qc.invalidateQueries({ queryKey: ["registo-vendas-hist"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const delRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("registo_vendas_hist").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Linha removida.");
      qc.invalidateQueries({ queryKey: ["registo-vendas-hist"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const isGerencia = !!(profile as { roles?: string[] } | undefined)?.roles?.includes("gerencia");
  const cancelarVenda = useMutation({
    mutationFn: async (venda: string) => {
      const { error } = await supabase.rpc("fin_cancelar_venda" as never, { p_venda: venda } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda cancelada.");
      qc.invalidateQueries({ queryKey: ["registo-vendas-hist"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["pag"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = produto ? rows.filter((r) => r.produto === produto) : rows;
    if (!q) return base;
    return base.filter((r) => {
      const d = new Date(r.data);
      const mes = `${MESES[d.getMonth()]} ${d.getFullYear()}`.toLowerCase();
      return (
        (r.nome ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.tel ?? "").toLowerCase().includes(q) ||
        (r.closer_nome ?? "").toLowerCase().includes(q) ||
        (r.sdr_nome ?? "").toLowerCase().includes(q) ||
        mes.includes(q)
      );
    });
  }, [rows, busca, produto]);

  const grupos = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtradas) {
      const key = String(r.data).slice(0, 7);
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, items]) => {
        const [y, m] = key.split("-");
        return {
          key,
          titulo: `MÊS DE ${MESES[Number(m) - 1].toUpperCase()} ${y}`,
          // dentro de cada mês: do dia mais recente para o mais antigo
          items: [...items].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)),
        };
      });
  }, [filtradas]);

  const cellCls = "eda-input w-full text-xs px-1.5 py-1 bg-transparent";

  const Txt = ({ r, campo, w }: { r: Row; campo: keyof Row; w: string }) => (
    <input
      className={cellCls}
      style={{ width: w }}
      defaultValue={(r[campo] as string | null) ?? ""}
      key={`${r.id}-${campo}-${String(r[campo] ?? "")}`}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v === (((r[campo] as string | null) ?? "").trim())) return;
        patch.mutate({ id: r.id, campo, valor: v === "" ? null : v });
      }}
    />
  );

  const Pessoa = ({ r, campo, w }: { r: Row; campo: "closer_nome" | "sdr_nome"; w: number }) => {
    const atual = (r[campo] as string | null) ?? "";
    const nomes = campo === "closer_nome" ? nomesCloser : nomesSdr;
    return (
      <select
        className={cellCls}
        style={{ width: w }}
        value={atual}
        onChange={(e) => patch.mutate({ id: r.id, campo, valor: e.target.value || null })}
      >
        <option value="">—</option>
        {nomes.map((n) => <option key={n} value={n}>{n}</option>)}
        {atual && !nomes.includes(atual) && <option value={atual}>{atual}</option>}

      </select>
    );
  };

  const Num = ({ r, campo, w }: { r: Row; campo: keyof Row; w: string }) => (
    <input
      className={`${cellCls} text-right`}
      style={{ width: w }}
      inputMode="decimal"
      defaultValue={r[campo] === null || r[campo] === undefined ? "" : String(r[campo])}
      key={`${r.id}-${campo}-${String(r[campo] ?? "")}`}
      onBlur={(e) => {
        const raw = e.target.value.replace(",", ".").trim();
        const atual = r[campo] === null || r[campo] === undefined ? "" : String(r[campo]);
        if (raw === atual) return;
        if (raw === "") {
          patch.mutate({ id: r.id, campo, valor: campo === "parcelas" ? null : 0 });
          return;
        }
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        patch.mutate({ id: r.id, campo, valor: campo === "parcelas" ? Math.round(n) : n });
      }}
    />
  );

  const LinkCell = ({ r, w }: { r: Row; w: string }) => {
    const atual = r.link_gravacao ?? "";
    return (
      <div className="flex items-center gap-1" style={{ width: w }}>
        <input
          type="url"
          className={cellCls}
          style={{ minWidth: 0, flex: 1 }}
          placeholder="https://..."
          defaultValue={atual}
          key={`${r.id}-link-${atual}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === atual.trim()) return;
            patch.mutate({ id: r.id, campo: "link_gravacao", valor: v === "" ? null : v });
          }}
        />
        {atual && (
          <a
            href={atual}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] px-2 py-1 rounded shrink-0 whitespace-nowrap"
            style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
          >
            Ver
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Registo de Vendas</h1>
        </div>
        <button className="eda-btn" onClick={() => addRow.mutate()} disabled={addRow.isPending}>
          + Adicionar linha
        </button>
      </div>

      <div className="eda-card">
        <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group" aria-label="Produto">
          {PRODUTOS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setProdKey(k)}
              className="text-xs px-3 py-1.5 rounded font-semibold"
              style={{ border: "1px solid var(--border)", background: prodKey === k ? "var(--accent)" : "transparent", color: prodKey === k ? "#fff" : "var(--text2)" }}>
              {l}
            </button>
          ))}
        </div>
        <input
          className="eda-input w-full md:w-80"
          placeholder="Procurar por nome, email, closer, SDR ou mês..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="text-sm" style={{ minWidth: 1700 }}>
            <thead>
              <tr style={{ color: "var(--text2)" }} className="text-left text-[11px] uppercase">
                <th className="py-2 px-1 whitespace-nowrap">Data</th>
                <th className="px-1 whitespace-nowrap">Nome do Lead</th>
                <th className="px-1 whitespace-nowrap">Email</th>
                <th className="px-1 whitespace-nowrap">Número</th>
                <th className="px-1 whitespace-nowrap">Closer</th>
                <th className="px-1 whitespace-nowrap">SDR</th>
                <th className="px-1 whitespace-nowrap text-right">Valor</th>
                <th className="px-1 whitespace-nowrap text-right">Pago no dia</th>
                <th className="px-1 whitespace-nowrap">Forma de Pagamento</th>
                <th className="px-1 whitespace-nowrap text-right">Parcelas</th>
                <th className="px-1 whitespace-nowrap">Tipo de Venda</th>
                <th className="px-1 whitespace-nowrap">Link da Call</th>
                <th className="px-1" />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => [
                <tr key={`h-${g.key}`} style={{ background: "var(--surface2)" }}>
                  <td colSpan={13} className="py-2 px-2 text-xs font-bold tracking-wider">
                    {g.titulo}
                    <span className="ml-3 font-normal" style={{ color: "var(--text2)" }}>
                      {monthlyFinancial.get(g.key)?.vendas ?? 0} vendas · valor {eur(monthlyFinancial.get(g.key)?.valor)} · pago {eur(monthlyFinancial.get(g.key)?.pago)}
                    </span>
                  </td>
                </tr>,
                ...g.items.map((r) => (
                  <tr key={r.id} className="border-t align-middle" style={{ borderColor: "var(--border)" }}>
                    <td className="py-1 px-1">
                      <input
                        type="date"
                        className={cellCls}
                        style={{ width: 130 }}
                        defaultValue={r.data}
                        key={`${r.id}-data-${r.data}`}
                        onBlur={(e) => {
                          if (!e.target.value || e.target.value === r.data) return;
                          patch.mutate({ id: r.id, campo: "data", valor: e.target.value });
                        }}
                      />
                    </td>
                    <td className="px-1">
                      <div className="flex items-center gap-1">
                        <input
                          className={`${cellCls} font-semibold rounded px-2`}
                          style={{
                            width: 150,
                            color: r.estado === "sem_estado" ? "var(--text)" : "#fff",
                            backgroundColor: r.estado === "sem_estado" ? "transparent" : ESTADO_COLOR[r.estado],
                            border: "1px solid var(--border)",
                          }}
                          defaultValue={r.nome ?? ""}
                          key={`${r.id}-nome-${r.nome}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v === (r.nome ?? "").trim()) return;
                            patch.mutate({ id: r.id, campo: "nome", valor: v });
                          }}
                        />
                        <div className="flex gap-1 shrink-0" title="Cor do nome do lead">
                          {ESTADOS.map((s) => (
                            <button
                              key={s}
                              type="button"
                              title={ESTADO_LABEL[s]}
                              aria-label={ESTADO_LABEL[s]}
                              onClick={() => patch.mutate({ id: r.id, campo: "estado", valor: s })}
                              className="rounded-full transition-transform"
                              style={{
                                width: 14,
                                height: 14,
                                background: ESTADO_SWATCH[s],
                                border: r.estado === s
                                  ? "2px solid var(--text)"
                                  : s === "sem_estado"
                                    ? "1px dashed var(--text3)"
                                    : "1px solid transparent",
                                opacity: r.estado === s ? 1 : 0.45,
                                cursor: "pointer",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-1"><Txt r={r} campo="email" w="230px" /></td>
                    <td className="px-1"><Txt r={r} campo="tel" w="150px" /></td>
                    <td className="px-1"><Pessoa r={r} campo="closer_nome" w={130} /></td>
                    <td className="px-1"><Pessoa r={r} campo="sdr_nome" w={130} /></td>
                    <td className="px-1"><Num r={r} campo="valor" w="95px" /></td>
                    <td className="px-1"><Num r={r} campo="pago" w="95px" /></td>
                    <td className="px-1">
                      <select
                        className={cellCls}
                        style={{ width: 175 }}
                        value={r.forma_pagamento ?? ""}
                        onChange={(e) => {
                          const f = e.target.value || null;
                          patch.mutate({ id: r.id, campo: "forma_pagamento", valor: f });
                          if (r.estado !== "cancelado") {
                            patch.mutate({ id: r.id, campo: "estado", valor: estadoAuto(f, r.parcelas) });
                          }
                        }}
                      >
                        <option value="">—</option>
                        {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
                        {r.forma_pagamento && !FORMAS.includes(r.forma_pagamento) && (
                          <option value={r.forma_pagamento}>{r.forma_pagamento}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-1"><Num r={r} campo="parcelas" w="65px" /></td>
                    <td className="px-1">
                      <select
                        className={cellCls}
                        style={{ width: 150 }}
                        value={r.tipo_venda ?? ""}
                        onChange={(e) => patch.mutate({ id: r.id, campo: "tipo_venda", valor: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                        {r.tipo_venda && !TIPOS.includes(r.tipo_venda) && (
                          <option value={r.tipo_venda}>{r.tipo_venda}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-1"><LinkCell r={r} w="210px" /></td>
                    <td className="px-1 whitespace-nowrap">
                      {isGerencia && r.venda_id && r.estado !== "cancelado" && (
                        <button
                          className="text-xs underline mr-2"
                          style={{ color: "var(--red)" }}
                          disabled={cancelarVenda.isPending}
                          onClick={() => {
                            if (confirm(`Cancelar a venda de "${r.nome || "sem nome"}"? As parcelas pendentes ficam canceladas; as pagas não mudam.`)) cancelarVenda.mutate(r.venda_id!);
                          }}
                        >
                          Cancelar venda
                        </button>
                      )}
                      {isSocio && (
                        <button
                          className="text-xs underline"
                          style={{ color: "var(--red)" }}
                          onClick={() => {
                            if (confirm(`Apagar o registo de "${r.nome || "sem nome"}"?`)) delRow.mutate(r.id);
                          }}
                        >
                          Apagar
                        </button>
                      )}
                    </td>
                  </tr>
                )),
              ])}
              {!isLoading && !grupos.length && (
                <tr>
                  <td colSpan={13} className="py-6 text-center" style={{ color: "var(--text3)" }}>
                    Sem registos.
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={13} className="py-6 text-center" style={{ color: "var(--text3)" }}>
                    A carregar...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
