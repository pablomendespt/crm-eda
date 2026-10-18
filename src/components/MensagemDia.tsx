import { useState } from "react";
import { Button } from "@/components/ui/button";
import { financeRpc } from "@/lib/finance-reporting";
import { localISO, todayISO } from "@/lib/format";

/** Mensagem do dia: texto determinístico gerado no servidor (relatorio_dia). Só gerar e copiar. */
export function MensagemDia() {
  const ontem = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localISO(d); })();
  const hoje = todayISO();
  const [dia, setDia] = useState(ontem);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const futuro = dia > hoje;

  async function gerar() {
    setErro(""); setCopiado(false);
    if (futuro) return;
    setLoading(true);
    try {
      const r = await financeRpc<{ texto: string }>("relatorio_dia", { p_dia: dia });
      setTexto(r.texto);
    } catch (e) {
      setErro((e as Error).message || "Não foi possível gerar a mensagem.");
    } finally { setLoading(false); }
  }
  async function copiar() {
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <section className="eda-card space-y-3" aria-label="Mensagem do dia">
      <h2 className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--text2)" }}>Mensagem do dia</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Dia
          <input aria-label="Dia da mensagem" type="date" max={hoje} className="eda-input" value={dia}
            onChange={(e) => { setDia(e.target.value); setTexto(""); setCopiado(false); }} />
        </label>
        <Button onClick={gerar} disabled={loading || futuro || !dia}>{loading ? "A gerar…" : "Gerar mensagem"}</Button>
        <Button variant="outline" onClick={copiar} disabled={!texto}>{copiado ? "Copiado" : "Copiar"}</Button>
      </div>
      {futuro && <p className="text-sm" style={{ color: "var(--red)" }}>Não é possível gerar a mensagem de um dia futuro.</p>}
      {erro && <p className="text-sm" style={{ color: "var(--red)" }}>{erro}</p>}
      {texto && (
        <pre data-testid="mensagem-dia" className="text-sm font-mono whitespace-pre-wrap break-words p-3 rounded border"
          style={{ borderColor: "var(--border)" }}>{texto}</pre>
      )}
    </section>
  );
}
