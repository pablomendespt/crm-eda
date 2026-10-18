import { historicoLabel, type CallSummary } from '@/lib/calls-reporting';
export function CallsHistoryNote({ r }: { r: CallSummary }) {
  const t = historicoLabel(r);
  return t ? <p className="text-xs text-muted-foreground">{t}</p> : null;
}
