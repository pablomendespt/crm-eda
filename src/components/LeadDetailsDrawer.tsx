import { useState } from "react";
import { Copy, Check, ExternalLink, Pencil, X } from "lucide-react";
import { eur } from "@/lib/format";
import { leadEstadoInfo, origemLabel, PRIO_LABEL, type FollowUpLead, type FollowUpPrioridade } from "@/lib/followups";

function fmtDT(s: string | null, withTime: boolean) {
  if (!s) return "—";
  const d = new Date(s);
  return withTime
    ? d.toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })
    : d.toLocaleDateString("pt-PT");
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function LeadDetailsDrawer({ lead, memberNames, onClose, onEdit }: {
  lead: FollowUpLead; memberNames: Record<string, string>; onClose: () => void; onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const est = leadEstadoInfo(lead.fu_estado);

  async function copy() {
    if (!lead.tel) return;
    try { await navigator.clipboard.writeText(lead.tel); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem permissão */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto" role="dialog" aria-label={`Lead ${lead.nome}`}
        style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-start justify-between gap-3 p-6" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <h2 className="text-xl font-bold truncate">{lead.nome}</h2>
            <span className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: "var(--surface3)", color: est.color }}>{est.label}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={onEdit} className="eda-btn-ghost flex items-center gap-1.5 text-xs"><Pencil size={13} /> Editar</button>
            <button type="button" onClick={onClose} aria-label="Fechar" className="w-9 h-9 flex items-center justify-center rounded-md" style={{ color: "var(--text3)" }}><X size={16} /></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <Sec title="Lead">
            <Row k="Número">
              {lead.tel ? (
                <span className="inline-flex items-center gap-2">
                  {lead.tel}
                  <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md" style={{ background: "var(--surface3)", color: copied ? "var(--green)" : "var(--accent)" }}>
                    {copied ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
                  </button>
                </span>
              ) : "—"}
            </Row>
            <Row k="E-mail">{lead.email || "—"}</Row>
          </Sec>
          <Sec title="Oferta">
            <Row k="Produto">{lead.produto || "—"}</Row>
            <Row k="Ticket">{lead.ticket ? eur(lead.ticket) : "—"}</Row>
            <Row k="Valor do sinal">{lead.deu_sinal ? eur(lead.sinal) : "—"}</Row>
          </Sec>
          <Sec title="Responsáveis">
            <Row k="Closer">{lead.closer_id ? memberNames[lead.closer_id] ?? "—" : "—"}</Row>
            <Row k="SDR que agendou">{lead.sdr_id ? memberNames[lead.sdr_id] ?? "—" : "—"}</Row>
            <Row k="Origem">{origemLabel(lead.origem)}</Row>
          </Sec>
          <Sec title="Datas">
            <Row k="1ª call">{lead.call_1_at ? fmtDT(lead.call_1_at, true) : fmtDate(lead.data_1call)}</Row>
            <Row k="Previsão de fecho">{fmtDate(lead.data_prevista_fecho)}</Row>
          </Sec>
          <Sec title="Estado">
            <Row k="Estado"><span style={{ color: est.color }}>{est.label}</span></Row>
            <Row k="Prioridade">{PRIO_LABEL[lead.prioridade as FollowUpPrioridade] ?? "—"}</Row>
            <Row k="Deu sinal?">{lead.deu_sinal ? "Sim" : "Não"}</Row>
          </Sec>
          <Sec title="Atividade">
            <Row k="Follow-ups">{lead.qtd_followups}</Row>
            <Row k="Ligações">{lead.qtd_ligacoes}</Row>
          </Sec>
          <Sec title="Call">
            <Row k="Link da 1ª call">
              {lead.link_call ? (
                <a href={lead.link_call} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                  Ver call <ExternalLink size={12} />
                </a>
              ) : "—"}
            </Row>
          </Sec>
          <Sec title="Observações">
            <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: lead.notas ? "var(--text)" : "var(--text3)" }}>{lead.notas || "Sem observações."}</p>
          </Sec>
        </div>
      </aside>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text3)" }}>{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span style={{ color: "var(--text2)" }}>{k}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
