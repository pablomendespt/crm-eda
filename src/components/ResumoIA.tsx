import { useState } from "react";
import { toast } from "sonner";
import { resumirDesempenho } from "@/lib/analise-ia.functions";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} className="h-2" />;
        const inline = (s: string) =>
          s.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
            p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
          );
        if (t.startsWith("## ") || t.startsWith("# "))
          return <h3 key={i} className="text-[11px] uppercase tracking-wider font-semibold pt-3" style={{ color: "var(--text2)" }}>{t.replace(/^#+\s/, "")}</h3>;
        if (/^[-*]\s/.test(t)) return <div key={i} className="pl-4">• {inline(t.slice(2))}</div>;
        if (/^\d+\.\s/.test(t)) return <div key={i} className="pl-4">{inline(t)}</div>;
        return <p key={i}>{inline(t)}</p>;
      })}
    </div>
  );
}

export function ResumoIA() {
  const hoje = new Date();
  const [inicio, setInicio] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [fim, setFim] = useState(iso(hoje));
  const [foco, setFoco] = useState("");
  const [loading, setLoading] = useState(false);
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fn = resumirDesempenho as (args: { data: { inicio: string; fim: string; foco?: string } }) => Promise<{ ok: true; texto: string } | { ok: false; error: string }>;

  async function gerar() {
    setLoading(true); setErro(null); setTexto(null);
    try {
      const r = await fn({ data: { inicio, fim, foco: foco.trim() || undefined } });
      if (r.ok) setTexto(r.texto); else setErro((r as any).error);
    } catch (e) {
      const msg = e instanceof Error && e.message === "Funcionalidade indisponível nesta versão"
        ? e.message
        : "Não foi possível gerar o resumo. Tente novamente.";
      setErro(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const input = "px-3 py-2 rounded border text-sm bg-transparent";
  const bs = { borderColor: "var(--border)" };
  return (
    <section className="eda-card space-y-4">
      <div>
        <h2 className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--text2)" }}>Resumo com IA para o daily</h2>
        <p className="text-xs mt-1" style={{ color: "var(--text3)" }}>Escolha o período. A IA lê os números do CRM, resume, aponta desvios e sugere prioridades.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1"><div style={{ color: "var(--text2)" }}>De</div>
          <input type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} className={input} style={bs} /></label>
        <label className="text-xs space-y-1"><div style={{ color: "var(--text2)" }}>Até</div>
          <input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} className={input} style={bs} /></label>
        <label className="text-xs space-y-1 flex-1 min-w-[200px]"><div style={{ color: "var(--text2)" }}>Foco (opcional)</div>
          <input value={foco} maxLength={500} onChange={(e) => setFoco(e.target.value)} placeholder="Ex.: conversão da Mariana" className={`${input} w-full`} style={bs} /></label>
        <button onClick={gerar} disabled={loading || !inicio || !fim}
          className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--accent)", color: "var(--background)", minHeight: 40 }}>
          {loading ? "A analisar…" : "Gerar resumo"}
        </button>
      </div>
      {erro && <div className="text-sm" style={{ color: "var(--danger)" }}>{erro}</div>}
      {texto && <div className="border-t pt-3" style={bs}><Markdown text={texto} /></div>}
    </section>
  );
}
