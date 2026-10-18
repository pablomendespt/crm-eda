import { useMemo, useState } from "react";

export type PeriodPreset = "hoje" | "7d" | "30d" | "mes" | "custom";
export const PERIOD_OPTIONS: [PeriodPreset, string][] = [
  ["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["mes", "Este mês"], ["custom", "Personalizado"],
];

const pad = (n: number) => String(n).padStart(2, "0");
/** Data local (não UTC) em AAAA-MM-DD. */
export function isoLocal(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Intervalo inclusivo. "7 dias" e "30 dias" terminam hoje e incluem hoje. */
export function periodRange(preset: PeriodPreset, now: Date = new Date(), customFrom = "", customTo = ""): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return isoLocal(d); };
  if (preset === "hoje") return { from: isoLocal(today), to: isoLocal(today) };
  if (preset === "7d") return { from: back(6), to: isoLocal(today) };
  if (preset === "30d") return { from: back(29), to: isoLocal(today) };
  if (preset === "mes") return { from: isoLocal(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoLocal(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  const f = customFrom || isoLocal(today); const t = customTo || f;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

/** Intervalo de um mês "AAAA-MM". */
export function monthRange(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return { from: `${mes}-01`, to: isoLocal(new Date(y, m, 0)) };
}

/** Estado partilhado de período: nunca persistido, abre sempre no preset por defeito. */
export function usePeriod(initial: PeriodPreset = "mes") {
  const [preset, setPreset] = useState<PeriodPreset>(initial);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => periodRange(preset, new Date(), customFrom, customTo), [preset, customFrom, customTo]);
  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, ...range };
}
export type PeriodState = ReturnType<typeof usePeriod>;
