import { PERIOD_OPTIONS, type PeriodState } from "@/lib/period";

export function PeriodFilter({ period }: { period: PeriodState }) {
  const { preset, setPreset, from, to, setCustomFrom, setCustomTo } = period;
  return (
    <>
      <div>
        <div className="text-[10px] uppercase font-semibold mb-1" style={{ color: "var(--text3)" }}>Período</div>
        <div className="eda-segmented flex flex-wrap gap-1" role="group" aria-label="Período">
          {PERIOD_OPTIONS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => {
              if (k === "custom") { setCustomFrom(from); setCustomTo(to); }
              setPreset(k);
            }} aria-pressed={preset === k} className="text-xs px-3 py-1.5 rounded">{label}</button>
          ))}
        </div>
      </div>
      {preset === "custom" && (
        <>
          <label className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>De
            <input type="date" aria-label="De" className="eda-input block mt-1" value={from} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
          </label>
          <label className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Até
            <input type="date" aria-label="Até" className="eda-input block mt-1" value={to} onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
          </label>
        </>
      )}
    </>
  );
}
