import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { eur, fmtDate } from "@/lib/format";
import { friendlyError } from "@/lib/rls-error";
import { useMembrosDir } from "@/lib/membros";

export const Route = createFileRoute("/_authenticated/customer-success")({
  component: CustomerSuccessPage,
});

type Row = {
  id: string;
  venda_id: string | null;
  nome_cliente: string;
  email: string | null;
  tel: string | null;
  produto: string | null;
  valor: number | string;
  data_venda: string;
  cs_member_id: string | null;
  fase: string;
  prioridade: string;
  data_boas_vindas: string | null;
  data_primeira_sessao: string | null;
  data_conclusao: string | null;
  notas: string | null;
  cancelado: boolean;
};

const FASES: { key: string; label: string; cor: string }[] = [
  { key: "novo", label: "Novo aluno", cor: "var(--blue, #3b82f6)" },
  { key: "boas_vindas", label: "Boas-vindas enviadas", cor: "var(--gold)" },
  { key: "onboarding", label: "Onboarding em curso", cor: "var(--gold)" },
  { key: "ativo", label: "Ativo", cor: "var(--green)" },
  { key: "em_risco", label: "Em risco", cor: "var(--red, #ef4444)" },
  { key: "concluido", label: "Onboarding concluído", cor: "var(--green)" },
];

const PRIORIDADES = [
  { key: "alta", label: "Alta" },
  { key: "media", label: "Média" },
  { key: "baixa", label: "Baixa" },
];

function labelFase(k: string) {
  return FASES.find((f) => f.key === k)?.label ?? k;
}

function CustomerSuccessPage() {
  const qc = useQueryClient();
  const { todos: membros } = useMembrosDir();
  const [fase, setFase] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [mostrarCancelados, setMostrarCancelados] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["cs_onboarding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cs_onboarding")
        .select("*")
        .order("data_venda", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Row> }) => {
      const { error } = await supabase.from("cs_onboarding").update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs_onboarding"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (!mostrarCancelados && r.cancelado) return false;
      if (fase !== "todas" && r.fase !== fase) return false;
      if (!t) return true;
      return [r.nome_cliente, r.email, r.tel, r.produto].some((v) =>
        String(v ?? "").toLowerCase().includes(t),
      );
    });
  }, [rows, fase, busca, mostrarCancelados]);

  const totais = useMemo(() => {
    const todos = rows ?? [];
    const ativos = todos.filter((r) => !r.cancelado);
    return {
      total: ativos.length,
      semOnboarding: ativos.filter((r) => r.fase === "novo").length,
      concluido: ativos.filter((r) => r.fase === "concluido").length,
      inativos: todos.filter((r) => r.cancelado).length,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Alunos</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          Todas as vendas registadas entram aqui automaticamente para gestão do onboarding.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="eda-kpi">
          <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Alunos</div>
          <div className="text-xl font-bold mt-2">{totais.total}</div>
        </div>
        <div className="eda-kpi">
          <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Sem onboarding feito</div>
          <div className="text-xl font-bold mt-2" style={{ color: "var(--gold)" }}>{totais.semOnboarding}</div>
        </div>
        <div className="eda-kpi">
          <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Onboarding concluído</div>
          <div className="text-xl font-bold mt-2" style={{ color: "var(--green)" }}>{totais.concluido}</div>
        </div>
        <div className="eda-kpi">
          <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text2)" }}>Alunos inativos</div>
          <div className="text-xl font-bold mt-2" style={{ color: "var(--red, #ef4444)" }}>{totais.inativos}</div>
        </div>
      </div>

      <div className="eda-card flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor="cs-fase">Fase</label>
          <select id="cs-fase" className="eda-input" value={fase} onChange={(e) => setFase(e.target.value)}>
            <option value="todas">Todas</option>
            {FASES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }} htmlFor="cs-busca">Procurar</label>
          <input
            id="cs-busca"
            className="eda-input w-full"
            placeholder="Nome, email, telemóvel ou produto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={mostrarCancelados}
            onChange={(e) => setMostrarCancelados(e.target.checked)}
          />
          Mostrar cancelados
        </label>
      </div>

      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--text3)" }}>A carregar...</div>
      ) : lista.length === 0 ? (
        <div className="eda-card py-8 text-center text-sm" style={{ color: "var(--text3)" }}>
          Sem alunos nesta vista.
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((r) => (
            <article key={r.id} className="eda-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    {r.nome_cliente}
                    {r.cancelado && (
                      <span className="ml-2 text-xs uppercase" style={{ color: "var(--red, #ef4444)" }}>cancelado</span>
                    )}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: "var(--text2)" }}>
                    {fmtDate(r.data_venda)} · {eur(Number(r.valor))}
                    {r.produto ? ` · ${r.produto}` : ""}
                    {r.email ? ` · ${r.email}` : ""}
                    {r.tel ? ` · ${r.tel}` : ""}
                  </p>
                </div>
                <span
                  className="text-[10px] uppercase font-semibold px-2 py-1 rounded"
                  style={{ color: FASES.find((f) => f.key === r.fase)?.cor ?? "var(--text2)", border: "1px solid var(--border)" }}
                >
                  {labelFase(r.fase)}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Fase</label>
                  <select
                    className="eda-input w-full"
                    aria-label={`Fase de ${r.nome_cliente}`}
                    value={r.fase}
                    onChange={(e) => save.mutate({ id: r.id, patch: { fase: e.target.value } })}
                  >
                    {FASES.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Responsável CS</label>
                  <select
                    className="eda-input w-full"
                    aria-label={`Responsável de Customer Success de ${r.nome_cliente}`}
                    value={r.cs_member_id ?? ""}
                    onChange={(e) =>
                      save.mutate({ id: r.id, patch: { cs_member_id: e.target.value || null } })
                    }
                  >
                    <option value="">—</option>
                    {membros
                      .filter((m) => m.ativo)
                      .map((m) => (
                        <option key={m.id} value={m.id}>{m.nome}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Prioridade</label>
                  <select
                    className="eda-input w-full"
                    aria-label={`Prioridade de ${r.nome_cliente}`}
                    value={r.prioridade}
                    onChange={(e) => save.mutate({ id: r.id, patch: { prioridade: e.target.value } })}
                  >
                    {PRIORIDADES.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Boas-vindas</label>
                  <input
                    type="date"
                    className="eda-input w-full"
                    aria-label={`Data de boas-vindas de ${r.nome_cliente}`}
                    defaultValue={r.data_boas_vindas ?? ""}
                    onBlur={(e) =>
                      save.mutate({ id: r.id, patch: { data_boas_vindas: e.target.value || null } })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>1.ª sessão</label>
                  <input
                    type="date"
                    className="eda-input w-full"
                    aria-label={`Data da primeira sessão de ${r.nome_cliente}`}
                    defaultValue={r.data_primeira_sessao ?? ""}
                    onBlur={(e) =>
                      save.mutate({ id: r.id, patch: { data_primeira_sessao: e.target.value || null } })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Conclusão</label>
                  <input
                    type="date"
                    className="eda-input w-full"
                    aria-label={`Data de conclusão do onboarding de ${r.nome_cliente}`}
                    defaultValue={r.data_conclusao ?? ""}
                    onBlur={(e) =>
                      save.mutate({ id: r.id, patch: { data_conclusao: e.target.value || null } })
                    }
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Notas de onboarding</label>
                <textarea
                  className="eda-input w-full"
                  rows={2}
                  aria-label={`Notas de onboarding de ${r.nome_cliente}`}
                  defaultValue={r.notas ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (r.notas ?? "")) save.mutate({ id: r.id, patch: { notas: v || null } });
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
