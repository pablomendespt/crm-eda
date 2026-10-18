import { AlertTriangle, Database, RefreshCw, ShieldAlert } from "lucide-react";

const TABLE_LABELS: Record<string, string> = {
  profiles: "Perfis de Utilizador",
  members: "Membros da Equipa",
  user_roles: "Permissões (Roles)",
  vendas: "Registo de Vendas",
  leads: "Pipeline de Leads",
  noshows: "Não Compareceu",
  cobrancas: "Cobranças",
  daily_stats: "Estatísticas Diárias",
};

interface Props {
  failedTables: string[];
  onRetry: () => void;
}

export function HealthCheckError({ failedTables, onRetry }: Props) {
  const isSingle = failedTables.length === 1;

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="max-w-lg w-full" style={{ background: "var(--surface3)", border: "1px solid var(--border)", borderRadius: 16, padding: 32 }}>
        <div className="flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
            style={{ background: "rgba(192,103,90,0.15)" }}
          >
            <AlertTriangle size={28} style={{ color: "var(--red)" }} />
          </div>

          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            Problema de ligação à base de dados
          </h1>

          <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text2)" }}>
            Não foi possível aceder {isSingle ? "a uma tabela crítica" : "a algumas tabelas críticas"} do CRM.
            Isto pode ser temporário — tenta recarregar a página.
          </p>
        </div>

        <div className="mt-6" style={{ background: "var(--surface2)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={16} style={{ color: "var(--red)" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--red)" }}>
              {isSingle ? "Tabela afetada" : `Tabelas afetadas (${failedTables.length})`}
            </span>
          </div>
          <ul className="space-y-2">
            {failedTables.map((t) => (
              <li key={t} className="flex items-center gap-3 text-sm" style={{ color: "var(--text)" }}>
                <Database size={14} style={{ color: "var(--text3)" }} />
                <span>{TABLE_LABELS[t] ?? t}</span>
                <code
                  className="ml-auto text-xs px-2 py-0.5 rounded"
                  style={{ background: "var(--bg)", color: "var(--text2)" }}
                >
                  {t}
                </code>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onRetry}
            className="flex-1 flex items-center justify-center gap-2 font-semibold"
            style={{
              background: "var(--accent)",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            <RefreshCw size={16} />
            Tentar novamente
          </button>
        </div>

        <p className="text-xs text-center mt-4" style={{ color: "var(--text3)" }}>
          Se o problema persistir, contacta um Sócio da EDA.
        </p>
      </div>
    </div>
  );
}
