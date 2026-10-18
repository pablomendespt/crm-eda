// Formatação PT-PT, EUR — sempre valor real, sem abreviações.
export function eur(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

// Mantido por compatibilidade — devolve exatamente o mesmo que eur().
// Nunca abreviar euros para "k", "m" ou "M" em nenhum lugar do CRM.
export const eurShort = eur;

export function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-PT");
}

// Data local (hora de Portugal), nunca UTC — evita contar o último dia do mês anterior.
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayISO(): string {
  return localISO(new Date());
}

export function monthStart(d = new Date()): string {
  return localISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function weekStart(d = new Date()): string {
  // Segunda-feira como início da semana
  const x = new Date(d);
  const day = x.getDay(); // 0=dom, 1=seg
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return localISO(x);
}
