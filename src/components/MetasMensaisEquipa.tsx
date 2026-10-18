import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { eur } from "@/lib/format";
import { friendlyError } from "@/lib/rls-error";
import { useFinanceSummary, EMPTY_SUMMARY, financeRpc } from "@/lib/finance-reporting";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function mesKey(dateISO: string) {
  return `${dateISO.slice(0, 7)}-01`;
}

/** Monthly team targets are stored only in metas_config. */
export function useMetasMensais(mes: string) {
  return useQuery({
    queryKey: ["metas_mensais_equipa", mes],
    queryFn: async () => {
      const rows = await financeRpc<{ id: string; metrica: string; valor: number; mes: string | null }[]>("fin_metas_mes_detalhe", { p_mes: mes });
      const get = (m: string) => { const r = rows.find(r => r.metrica === m); return r ? { id: r.id, alvo: r.valor, mes: r.mes } : undefined; };
      return { bruto: get("bruto"), liquido: get("liquido") };
    },
  });
}

// ---------------- Editor (página Metas, só sócios) ----------------
export function EditorMetasMensais() {
  const qc = useQueryClient();
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mesN, setMesN] = useState(now.getMonth() + 1);
  const mes = `${ano}-${pad(mesN)}-01`;
  const { data } = useMetasMensais(mes);
  const [bruto, setBruto] = useState("");
  const [liquido, setLiquido] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBruto(data?.bruto?.alvo != null ? String(data.bruto.alvo) : "");
    setLiquido(data?.liquido?.alvo != null ? String(data.liquido.alvo) : "");
  }, [data]);

  const guardar = async () => {
    setSaving(true);
    try {
      const pares: [string, string, string][] = [["bruto", bruto, "Meta bruta"], ["liquido", liquido, "Meta de caixa"]];
      for (const [metrica, valor, label] of pares) {
        const atual = metrica === "bruto" ? data?.bruto : data?.liquido;
        const v = valor.trim() === "" ? null : Number(valor.replace(",", "."));
        if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error(`${label}: valor inválido`);
        if (atual?.mes === mes) {
          if (v === null) {
            const { error } = await supabase.from("metas_config").delete().eq("id", atual.id);
            if (error) throw error;
          } else if (Number(atual.alvo) !== v) {
            const { error } = await supabase.from("metas_config").update({ valor: v } as never).eq("id", atual.id);
            if (error) throw error;
          }
        } else if (v !== null) {
          const { error } = await supabase.from("metas_config").insert({
            papel: "equipa", periodo: "mensal", metrica, mes, valor: v, ativo: true,
          } as never);
          if (error) throw error;
        }
      }
      toast.success("Metas do mês guardadas");
      qc.invalidateQueries({ queryKey: ["metas_mensais_equipa"] });
    } catch (e: any) {
      toast.error(friendlyError ? friendlyError(e) : e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="eda-card space-y-4">
      <div>
        <h2 className="font-semibold">Metas mensais da equipa</h2>
        <p className="text-xs mt-1" style={{ color: "var(--text3)" }}>
          Estes valores aparecem no Dashboard para toda a equipa. Deixa vazio para remover.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Mês</label>
          <select className="eda-input" value={mesN} onChange={(e) => setMesN(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Ano</label>
          <select className="eda-input" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Meta bruta (€)</label>
          <input className="eda-input" inputMode="decimal" value={bruto} onChange={(e) => setBruto(e.target.value)} placeholder="ex.: 12000" />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text2)" }}>Meta de caixa / líquido (€)</label>
          <input className="eda-input" inputMode="decimal" value={liquido} onChange={(e) => setLiquido(e.target.value)} placeholder="ex.: 6000" />
        </div>
        <button className="eda-btn" disabled={saving} onClick={guardar}>{saving ? "A guardar…" : "Guardar"}</button>
      </div>
    </section>
  );
}

// ---------------- Bloco do Dashboard (só leitura) ----------------
export function BlocoMetasEquipa({ refDate, isSocio }: { refDate: string; isSocio: boolean }) {
  const mes = mesKey(refDate);
  const [y, m] = mes.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const totalDias = last.getDate();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isAtual = today >= first && today <= last;
  const isFuturo = today < first;
  const diasDecorridos = isFuturo ? 0 : isAtual ? today.getDate() : totalDias;
  const ateISO = isAtual ? isoD(today) : isoD(last);

  const { data: metas } = useMetasMensais(mes);
  const { data: real = EMPTY_SUMMARY } = useFinanceSummary(isoD(first), isoD(last));

  const nomeMes = `${MESES[m - 1]} ${y}`;
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--text2)" }}>
        Metas gerais da equipa · {nomeMes}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CartaoMeta titulo={`Meta bruta — ${MESES[m - 1]}`} meta={metas?.bruto?.alvo} realizado={real?.bruto ?? 0}
          totalDias={totalDias} diasDecorridos={diasDecorridos} isSocio={isSocio} />
        <CartaoMeta titulo={`Meta de caixa — ${MESES[m - 1]}`} meta={metas?.liquido?.alvo} realizado={real?.liquido ?? 0}
          totalDias={totalDias} diasDecorridos={diasDecorridos} isSocio={isSocio} />
      </div>
    </section>
  );
}

function CartaoMeta({ titulo, meta, realizado, totalDias, diasDecorridos, isSocio }: {
  titulo: string; meta: number | null | undefined; realizado: number; totalDias: number; diasDecorridos: number; isSocio: boolean;
}) {
  const alvo = Number(meta ?? 0);
  const calc = useMemo(() => {
    const pct = alvo ? (realizado / alvo) * 100 : 0;
    const falta = Math.max(alvo - realizado, 0);
    const ideal = alvo * (diasDecorridos / totalDias);
    const diff = realizado - ideal;
    const semanas = totalDias / 7;
    const diasRest = totalDias - diasDecorridos;
    return {
      pct, falta, ideal, diff,
      semanal: alvo / semanas, diaria: alvo / totalDias,
      diariaRest: diasRest > 0 ? falta / diasRest : 0,
      semanalRest: diasRest > 0 ? falta / (diasRest / 7) : 0,
      diasRest,
    };
  }, [alvo, realizado, diasDecorridos, totalDias]);

  if (!alvo) {
    return (
      <div className="eda-kpi">
        <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--text2)" }}>{titulo}</div>
        <p className="text-sm mt-3" style={{ color: "var(--text3)" }}>Meta ainda não cadastrada para este mês.</p>
        {isSocio && <Link to="/metas" className="text-xs mt-2 inline-block" style={{ color: "var(--accent)" }}>Configurar em Metas</Link>}
      </div>
    );
  }

  const verdeClaro = "color-mix(in srgb, var(--green) 65%, var(--text))";
  const cor = calc.pct >= 100 ? "var(--green)" : calc.pct >= 80 ? verdeClaro : calc.pct >= 50 ? "var(--gold)" : "var(--accent)";
  const tolerancia = alvo * 0.01;
  const red = "var(--red, #ef4444)";
  const noRitmo = Math.abs(calc.diff) <= tolerancia;
  const acima = !noRitmo && calc.diff > 0;
  const estado = noRitmo
    ? { c: "var(--gold)", t: "No ritmo ideal", v: "" }
    : acima
      ? { c: "var(--green)", t: "↑ Acima do ritmo ideal", v: `+${eur(calc.diff)}` }
      : { c: red, t: "↓ Abaixo do ritmo ideal", v: `−${eur(-calc.diff)}` };
  const eyebrow = "text-[10px] uppercase tracking-wider font-semibold";
  const cinza = { color: "var(--text3)" };
  const branco = { color: "var(--text)" };

  return (
    <div className="eda-kpi flex flex-col gap-3 h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={eyebrow} style={{ color: "var(--text2)" }}>{titulo}</div>
          {calc.pct >= 100 && <div className="text-[11px] font-bold mt-1" style={{ color: "var(--green)" }}>META BATIDA 🎯</div>}
        </div>
        <div className="text-[28px] sm:text-[34px] leading-none font-extrabold tabular-nums" style={{ color: cor }}>
          {Math.round(calc.pct)}%
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl sm:text-[30px] font-extrabold leading-tight tabular-nums" style={{ color: "var(--accent)" }}>{eur(realizado)}</span>
        <span className="text-sm" style={cinza}>/ {eur(alvo)}</span>
      </div>

      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(calc.pct, 100)}%`, background: cor }} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className={eyebrow} style={cinza}>Falta para a meta</div>
          <div className="text-xl sm:text-2xl font-bold tabular-nums" style={branco}>{eur(calc.falta > 0 ? calc.falta : 0)}</div>
        </div>
        <div
          className="rounded-lg px-3 py-1.5 text-right"
          style={{ background: `color-mix(in srgb, ${estado.c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${estado.c} 40%, transparent)` }}
        >
          <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: estado.c }}>{estado.t}</div>
          {estado.v && <div className="text-sm font-bold tabular-nums" style={{ color: estado.c }}>{estado.v}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div><div className={eyebrow} style={cinza}>Ritmo ideal hoje</div><div className="text-sm font-medium tabular-nums" style={branco}>{eur(calc.ideal)}</div></div>
        <div style={{ color: estado.c }}><div className={eyebrow}>Ritmo atual</div><div className="text-sm font-bold tabular-nums">{eur(realizado)}</div></div>
      </div>

      <div className="mt-auto pt-2 border-t grid grid-cols-2 gap-3" style={{ borderColor: "var(--border)" }}>
        <div><div className={eyebrow} style={cinza}>Meta semanal</div><div className="text-sm font-semibold tabular-nums" style={branco}>{eur(calc.semanal)}</div></div>
        <div><div className={eyebrow} style={cinza}>Meta diária</div><div className="text-sm font-semibold tabular-nums" style={branco}>{eur(calc.diaria)}</div></div>
        {!noRitmo && !acima && calc.falta > 0 && calc.diasRest > 0 && (
          <div className="col-span-2 text-[11px] font-semibold" style={{ color: "var(--gold)" }}>Para recuperar o ritmo: {eur(calc.diariaRest)}/dia</div>
        )}
        {acima && <div className="col-span-2 text-[11px] font-semibold" style={{ color: "color-mix(in srgb, var(--green) 75%, transparent)" }}>Ritmo saudável</div>}
      </div>
    </div>
  );
}
