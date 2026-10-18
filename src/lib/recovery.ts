import type { Database } from "@/integrations/supabase/types";

export type RecoveryStatus = Database["public"]["Enums"]["recovery_status"];
export type RecoveryCanal = Database["public"]["Enums"]["recovery_canal"];
export type RecoveryLead = Database["public"]["Tables"]["recovery_leads"]["Row"];
export type RecoveryInteraction = Database["public"]["Tables"]["recovery_interactions"]["Row"];

export const STATUS_META: Record<RecoveryStatus, { label: string; color: string; text: string }> = {
  nao_contactado: { label: "Não contactado", color: "#6b7280", text: "#ffffff" },
  fu1_feito:      { label: "Follow-up 1 feito", color: "#93c5fd", text: "#0b1220" },
  fu2_feito:      { label: "Follow-up 2 feito", color: "#3b82f6", text: "#ffffff" },
  fu3_feito:      { label: "Follow-up 3 feito", color: "#1d4ed8", text: "#ffffff" },
  respondeu:      { label: "Respondeu", color: "#facc15", text: "#0b1220" },
  call_agendada:  { label: "Call agendada", color: "#f97316", text: "#0b1220" },
  fechou:         { label: "Fechou", color: "#22c55e", text: "#0b1220" },
  perdido:        { label: "Perdido", color: "#ef4444", text: "#ffffff" },
  nao_perturbar:  { label: "Não perturbar", color: "#111827", text: "#ffffff" },
};

export const STATUS_ORDER: RecoveryStatus[] = [
  "nao_contactado","fu1_feito","fu2_feito","fu3_feito","respondeu","call_agendada","fechou","perdido","nao_perturbar",
];

export const CANAL_META: Record<RecoveryCanal, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

// Normaliza número de telefone para WhatsApp (só dígitos)
export function normalizePhone(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}

export function whatsappLink(numero: string): string {
  const digits = normalizePhone(numero);
  return `https://wa.me/${digits}`;
}

// Parse simples de CSV: suporta valores entre aspas e vírgulas internas
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// dd/mm/yyyy → yyyy-mm-dd (ISO)
export function parseBrDate(s: string): string | null {
  const t = (s || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo}-${d}`;
  }
  // já pode vir yyyy-mm-dd
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m2 ? t : null;
}

export function isOverdueRecovery(date: string | null): boolean {
  if (!date) return false;
  const d = new Date(date + "T23:59:59");
  return d.getTime() < Date.now();
}
