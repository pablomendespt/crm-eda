import { financeRpc } from '@/lib/finance-reporting';
import type { CallSummary } from '@/lib/calls-reporting';
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Metas de CALLS REALIZADAS (semanal e mensal) para a página Meus Números (SDR).
// O realizado vem sempre de sdr_daily.calls_realizadas; só a meta é editável (sócios).

type Week = { n: number; from: string; to: string };

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function br(isoDate: string) {
  const [, m, d] = isoDate.split("-");
  return `${d}/${m}`;
}

// Semanas operacionais: segunda a sábado, domingo excluído; 1ª e última podem ser parciais.
export function semanasDoMes(y: number, m: number): Week[] {
  const last = new Date(y, m + 1, 0).getDate();
  const weeks: Week[] = [];
  let cur: Week | null = null;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(y, m, d).getDay();
    if (dow === 0) { cur = null; continue; }
    if (!cur) { cur = { n: weeks.length + 1, from: iso(y, m, d), to: iso(y, m, d) }; weeks.push(cur); }
    else cur.to = iso(y, m, d);
  }
  return weeks;
}

function todayParts() {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), iso: iso(t.getFullYear(), t.getMonth(), t.getDate()) };
}

type Props = {
  filterMember: string | undefined; // "all" | member id
  isSocio: boolean;
  sdrMembers: { id: string; nome: string }[];
};

export function SdrMetasCalls({ filterMember, isSocio, sdrMembers }: Props) {
  const now = todayParts();
  const qc = useQueryClient();

  // ---------- Semanal ----------
  const weeksNow = semanasDoMes(now.y, now.m);
  const currentWeek = weeksNow.find((w) => now.iso >= w.from && now.iso <= w.to) ?? weeksNow.find((w) => w.from > now.iso) ?? weeksNow[weeksNow.length - 1];
  const [wSel, setWSel] = useState<string>(String(currentWeek?.n ?? 1));
  const [cFrom, setCFrom] = useState(now.iso);
  const [cTo, setCTo] = useState(now.iso);
  const [cMeta, setCMeta] = useState<number>(0);
  const isCustom = wSel === "custom";
  const week = weeksNow.find((w) => String(w.n) === wSel);
  const wFrom = isCustom ? cFrom : week?.from ?? now.iso;
  const wTo = isCustom ? cTo : week?.to ?? now.iso;

  // ---------- Mensal ----------
  const [mY, setMY] = useState(now.y);
  const [mM, setMM] = useState(now.m);
  const mFrom = iso(mY, mM, 1);
  const mTo = iso(mY, mM, new Date(mY, mM + 1, 0).getDate());
  function shiftMonth(delta: number) {
    const d = new Date(mY, mM + delta, 1);
    setMY(d.getFullYear()); setMM(d.getMonth());
  }

  const memberFilter = filterMember && filterMember !== "all" ? filterMember : null;

  async function sumRealizadas(from: string, to: string) {
    return (await financeRpc<CallSummary[]>('calls_resumo',{p_from:from,p_to:to,p_sdr:memberFilter,p_base:'realizacao'}))[0]?.realizadas ?? 0;
  }

  const { data: wReal = 0 } = useQuery({
    queryKey: ["calls", "sdr-metas-real", "w", filterMember, wFrom, wTo],
    enabled: !!filterMember,
    queryFn: () => sumRealizadas(wFrom, wTo),
  });
  const { data: mReal = 0 } = useQuery({
    queryKey: ["calls", "sdr-metas-real", "m", filterMember, mFrom, mTo],
    enabled: !!filterMember,
    queryFn: () => sumRealizadas(mFrom, mTo),
  });

  const { data: metasW = [] } = useQuery({
    queryKey: ["sdr-metas-calls", "semanal", filterMember, now.y, now.m],
    enabled: !!filterMember,
    queryFn: async () => {
      let q = (supabase as any).from("sdr_metas_calls").select("*").eq("tipo", "semanal").eq("ano", now.y).eq("mes", now.m + 1);
      if (memberFilter) q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: metasM = [] } = useQuery({
    queryKey: ["sdr-metas-calls", "mensal", filterMember, mY, mM],
    enabled: !!filterMember,
    queryFn: async () => {
      let q = (supabase as any).from("sdr_metas_calls").select("*").eq("tipo", "mensal").eq("ano", mY).eq("mes", mM + 1);
      if (memberFilter) q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const wMeta = isCustom
    ? cMeta
    : metasW.filter((r) => r.semana === week?.n).reduce((s, r) => s + Number(r.meta ?? 0), 0);
  const mMeta = metasM.reduce((s, r) => s + Number(r.meta ?? 0), 0);

  // ---------- Edição ----------
  const [edit, setEdit] = useState<null | "semanal" | "mensal">(null);
  const [eMember, setEMember] = useState<string>("");
  const [eWeek, setEWeek] = useState<string>(String(currentWeek?.n ?? 1));
  const [eMeta, setEMeta] = useState<string>("");
  const [saving, setSaving] = useState(false);

  function openEdit(tipo: "semanal" | "mensal") {
    const m = memberFilter ?? sdrMembers[0]?.id ?? "";
    setEMember(m);
    if (tipo === "semanal") {
      const n = week?.n ?? currentWeek?.n ?? 1;
      setEWeek(String(n));
      const ex = metasW.find((r) => r.member_id === m && r.semana === n);
      setEMeta(ex ? String(ex.meta) : "");
    } else {
      const ex = metasM.find((r) => r.member_id === m);
      setEMeta(ex ? String(ex.meta) : "");
    }
    setEdit(tipo);
  }

  async function saveMeta() {
    if (!eMember) { toast.error("Escolhe o SDR"); return; }
    const meta = Math.max(0, Math.round(Number(eMeta) || 0));
    let payload: any;
    if (edit === "semanal") {
      const w = weeksNow.find((x) => String(x.n) === eWeek);
      if (!w) return;
      payload = { member_id: eMember, tipo: "semanal", ano: now.y, mes: now.m + 1, semana: w.n, data_inicio: w.from, data_fim: w.to, meta };
    } else {
      payload = { member_id: eMember, tipo: "mensal", ano: mY, mes: mM + 1, semana: null, data_inicio: mFrom, data_fim: mTo, meta };
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("sdr_metas_calls")
      .upsert(payload, { onConflict: "member_id,tipo,ano,mes,semana" });
    setSaving(false);
    if (error) { toast.error("Erro ao guardar meta", { description: error.message }); return; }
    toast.success("Meta guardada");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["sdr-metas-calls"] });
  }

  const editWeek = weeksNow.find((x) => String(x.n) === eWeek);

  return (
    <div className="space-y-4">
      <MetaCard
        title="Meta semanal — calls realizadas"
        periodo={`${br(wFrom)} — ${br(wTo)}`}
        meta={wMeta}
        real={wReal}
        canEdit={isSocio && !isCustom}
        onEdit={() => openEdit("semanal")}
        controls={
          <select value={wSel} onChange={(e) => setWSel(e.target.value)} className="eda-input">
            {weeksNow.map((w) => <option key={w.n} value={String(w.n)}>{w.n}ª Semana</option>)}
            <option value="custom">Personalizado</option>
          </select>
        }
        extra={isCustom && (
          <div className="flex flex-wrap gap-3 mb-3">
            <div>
              <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>Data inicial</label>
              <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="eda-input" />
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>Data final</label>
              <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="eda-input" />
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>Meta do período</label>
              <input type="number" min={0} value={cMeta || ""} placeholder="0" onChange={(e) => setCMeta(Number(e.target.value) || 0)} className="eda-input w-28" />
            </div>
          </div>
        )}
      />

      <MetaCard
        title="Meta mensal — calls realizadas"
        periodo={`${br(mFrom)} — ${br(mTo)}`}
        meta={mMeta}
        real={mReal}
        canEdit={isSocio}
        onEdit={() => openEdit("mensal")}
        controls={
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shiftMonth(-1)} className="eda-btn-ghost" aria-label="Mês anterior">‹</button>
            <span className="text-sm font-semibold px-2 min-w-[130px] text-center">{MESES[mM]} {mY}</span>
            <button type="button" onClick={() => shiftMonth(1)} className="eda-btn-ghost" aria-label="Mês seguinte">›</button>
          </div>
        }
      />

      {edit && (
        <div className="eda-card space-y-3">
          <div className="text-xs uppercase font-semibold" style={{ color: "var(--text2)" }}>
            Editar meta {edit === "semanal" ? "semanal" : "mensal"}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>SDR</label>
              <select value={eMember} onChange={(e) => setEMember(e.target.value)} className="eda-input">
                {sdrMembers.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
            {edit === "semanal" ? (
              <>
                <div>
                  <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>Semana</label>
                  <select value={eWeek} onChange={(e) => setEWeek(e.target.value)} className="eda-input">
                    {weeksNow.map((w) => <option key={w.n} value={String(w.n)}>{w.n}ª Semana</option>)}
                  </select>
                </div>
                <div className="text-sm pb-2" style={{ color: "var(--text2)" }}>
                  {editWeek ? `${br(editWeek.from)} — ${br(editWeek.to)}` : ""}
                </div>
              </>
            ) : (
              <div className="text-sm pb-2" style={{ color: "var(--text2)" }}>{MESES[mM]} {mY}</div>
            )}
            <div>
              <label className="block text-[11px] mb-1" style={{ color: "var(--text3)" }}>Meta de calls realizadas</label>
              <input type="number" min={0} value={eMeta} onChange={(e) => setEMeta(e.target.value)} className="eda-input w-28" />
            </div>
            <button type="button" onClick={() => setEdit(null)} className="eda-btn-ghost">Cancelar</button>
            <button type="button" onClick={saveMeta} disabled={saving} className="eda-btn">{saving ? "A guardar..." : "Guardar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaCard({
  title, periodo, meta, real, canEdit, onEdit, controls, extra,
}: {
  title: string; periodo: string; meta: number; real: number; canEdit: boolean;
  onEdit: () => void; controls: React.ReactNode; extra?: React.ReactNode;
}) {
  const hasMeta = meta > 0;
  const pctVal = hasMeta ? Math.round((real / meta) * 100) : 0;
  const diff = real - meta;
  return (
    <div className="eda-card">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <div className="text-xs uppercase font-semibold" style={{ color: "var(--text2)" }}>{title}</div>
          <div className="text-[11px] mt-1" style={{ color: "var(--text3)" }}>{periodo}</div>
        </div>
        <div className="flex items-center gap-3">
          {controls}
          {canEdit && (
            <button type="button" onClick={onEdit} className="text-[11px] underline" style={{ color: "var(--text3)" }}>
              Editar meta
            </button>
          )}
        </div>
      </div>
      {extra}
      {hasMeta ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-2xl font-bold">
                {real} <span className="text-sm font-normal" style={{ color: "var(--text3)" }}>de {meta}</span>
              </div>
              <div className="text-xs mt-1" style={{ color: diff >= 0 ? "var(--gold)" : "var(--text3)" }}>
                {diff >= 0 ? (diff === 0 ? "Meta atingida" : `+${diff} acima da meta`) : `Faltam ${-diff}`}
              </div>
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--gold)" }}>{pctVal}%</div>
          </div>
          <div className="w-full h-3 rounded-full" style={{ background: "var(--surface2)" }}>
            <div className="h-3 rounded-full" style={{ width: `${Math.min(100, pctVal)}%`, background: "var(--gold)" }} />
          </div>
        </>
      ) : (
        <div className="text-sm" style={{ color: "var(--text2)" }}>
          Meta ainda não definida. <span style={{ color: "var(--text3)" }}>Realizadas: {real}</span>
        </div>
      )}
    </div>
  );
}
