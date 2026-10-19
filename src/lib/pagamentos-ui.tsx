import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/rls-error";

// Peças partilhadas das telas de Pagamentos e Parcelas.
// Todos os números vêm de funções do servidor (fin_*). Nada é somado aqui.
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
export async function call<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}



export function Msg({ children }: { children: ReactNode }) {
  return <div className="text-sm" style={{ color: "var(--text2)" }}>{children}</div>;
}
export function Tabela({ head, children, min = 700, stickyFirst }: { head: string[]; children: ReactNode; min?: number; stickyFirst?: boolean }) {
  return (
    <div className="eda-card p-0 overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead>
          <tr className="text-left text-[11px] uppercase" style={{ color: "var(--text2)", background: "var(--surface2)" }}>
            {head.map((h, i) => <th key={h} className={"px-4 py-3 font-semibold tracking-[.08em] whitespace-nowrap" + (stickyFirst && i === 0 ? " sticky left-0 z-10" : "")} style={stickyFirst && i === 0 ? { background: "var(--surface2)" } : undefined}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const TD = "px-4 py-2.5 border-t whitespace-nowrap";
export const tdStyle = { borderColor: "var(--border)" };
export const COR: Record<string, string> = { paga: "var(--green)", pendente: "var(--accent)", atrasada: "var(--gold)", cancelada: "var(--red)" };
export function Tag({ k }: { k: string }) {
  const c = COR[k] ?? "var(--text3)";
  return <span className="inline-block rounded-full text-[11px] px-2.5 py-1 font-semibold capitalize"
    style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}>{k}</span>;
}

/** Valor editável com duplo clique (só quando `can`). */
export function Editavel({ value, display, can, type = "number", onSave }: {
  value: string; display: ReactNode; can: boolean; type?: string; onSave: (v: string) => Promise<unknown>;
}) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState(value);
  if (!can) return <>{display}</>;
  if (!ed) return <span onDoubleClick={() => { setV(value); setEd(true); }} title="Duplo clique para editar" className="cursor-text border-b border-dashed" style={{ borderColor: "var(--text3)" }}>{display}</span>;
  const save = async () => {
    try { await onSave(v); setEd(false); toast.success("Guardado"); } catch (e) { toast.error(friendlyError(e as any)); }
  };
  return <input autoFocus type={type} step="0.01" className="eda-input w-32" value={v} onChange={(e) => setV(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEd(false); }} onBlur={() => setEd(false)} />;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "color-mix(in srgb, var(--bg) 75%, transparent)" }} onClick={onClose}>
      <div className="eda-card w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Fechar" onClick={onClose} className="p-2"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function useInvalidate() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["pag"] }); qc.invalidateQueries({ queryKey: ["finance"] }); };
}

export function Campo({ l, children }: { l: string; children: ReactNode }) {
  return <label className="block text-xs font-medium space-y-1" style={{ color: "var(--text2)" }}><span>{l}</span>{children}</label>;
}

