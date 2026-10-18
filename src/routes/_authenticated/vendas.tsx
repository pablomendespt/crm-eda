import { useCallsList } from '@/lib/calls-reporting';
import { createFileRoute } from "@tanstack/react-router";
import { friendlyError } from "@/lib/rls-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { eur, todayISO, fmtDate } from "@/lib/format";
import { useMembrosDir } from "@/lib/membros";

export const Route = createFileRoute("/_authenticated/vendas")({
  validateSearch: (s: Record<string, unknown>) => ({
    nome: typeof s.nome === "string" ? s.nome : undefined,
    tel: typeof s.tel === "string" ? s.tel : undefined,
    ticket: typeof s.ticket === "string" ? s.ticket : undefined,
  }),
  component: VendasPage,
});

function VendasPage() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const isSocio = profile?.role === "socio";
  const myMemberId = profile?.profile?.member_id;

  const { data: members } = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_members_directory");
      return ((data ?? []) as { id: string; nome: string; role: string; ativo: boolean }[])
        .filter((m) => m.ativo);
    },
  });

  const { data: membersFull } = useQuery({
    queryKey: ["members-full"],
    enabled: isSocio,
    queryFn: async () => {
      const { data } = await supabase.from("members").select("id, is_founder, comissao_pct").eq("ativo", true);
      return data ?? [];
    },
  });
  const fullById = useMemo(
    () => Object.fromEntries((membersFull ?? []).map((m) => [m.id, m])),
    [membersFull],
  );

  // Qualquer membro ativo pode ser atribuído como closer ou SDR numa venda
  // (ex.: um SDR que fecha diretamente na DM soma 3% SDR + 7% closer).
  const { closers, sdrs } = useMembrosDir();

  useEffect(() => {
    const channel = supabase
      .channel("vendas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "vendas" }, () => {
        qc.invalidateQueries({ queryKey: ["calls"] });
      qc.invalidateQueries({ queryKey: ["vendas"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["daily_stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cobrancas" }, () => {
        qc.invalidateQueries({ queryKey: ["cobrancas"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const search = Route.useSearch();
  useEffect(() => {
    if (search.nome || search.tel || search.ticket) {
      setForm((f) => ({
        ...f,
        nome_cliente: search.nome ?? f.nome_cliente,
        tel: search.tel ?? f.tel,
        ticket: search.ticket ?? f.ticket,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.nome, search.tel, search.ticket]);

  const [isSinal, setIsSinal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const EMPTY_FORM = {
    data: todayISO(),
    nome_cliente: "",
    email: "",
    tel: "",
    produto: "",
    closer_id: "",
    sdr_id: "",
    ticket: "",
    valor_total_previsto: "",
    data_prevista_fecho: "",

    forma_pagamento: "Cartão - à vista",
    parcelas: "1",
    valor_parcela: "",
    pago: "",
    notas: "",
    link_gravacao: "",
    call_id: "",
  };
  const [form, setForm] = useState(EMPTY_FORM);
  const { data: availableCalls = [] } = useCallsList();

  // Closer é automático (o membro ligado ao utilizador). Só o Sócio pode escolher.
  useEffect(() => {
    if (!isSocio && myMemberId && !editingId) {
      setForm((f) => (f.closer_id === myMemberId ? f : { ...f, closer_id: myMemberId }));
    }
  }, [isSocio, myMemberId, editingId]);

  function startEdit(v: any) {
    setEditingId(v.id);
    setIsSinal(!!v.is_sinal);
    setForm({
      data: v.data ?? todayISO(),
      nome_cliente: v.nome_cliente ?? "",
      email: v.email ?? "",
      tel: v.tel ?? "",
      produto: v.produto ?? "",
      closer_id: v.closer_id ?? "",
      sdr_id: v.sdr_id ?? "",
      ticket: String(v.ticket ?? ""),
      valor_total_previsto: v.valor_total_previsto == null ? "" : String(v.valor_total_previsto),
      data_prevista_fecho: v.data_prevista_fecho ?? "",

      forma_pagamento: v.forma_pagamento ?? "Cartão - à vista",
      parcelas: String(v.parcelas ?? 1),
      valor_parcela: v.valor_parcela ? String(v.valor_parcela) : "",
      pago: String(v.pago ?? 0),
      notas: v.notas ?? "",
      link_gravacao: v.link_gravacao ?? "",
      call_id: v.call_id ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setIsSinal(false);
    setForm({ ...EMPTY_FORM, closer_id: isSocio ? "" : (myMemberId ?? "") });
  }

  const canManage = (v: any) => isSocio || (!!myMemberId && v.closer_id === myMemberId);

  const closer = closers.find((c) => c.id === form.closer_id);
  const sdr = sdrs.find((s) => s.id === form.sdr_id);
  const closerFull = closer ? fullById[closer.id] : undefined;
  const sdrFull = sdr ? fullById[sdr.id] : undefined;
  const ticketN = Number(form.ticket) || 0;
  const totalPrevN = Number(form.valor_total_previsto) || 0;
  const commBaseN = isSinal ? totalPrevN : ticketN;
  // Closer = 7%. SDR usa a percentagem da ficha do membro (padrão 3%). Founders não recebem.
  const sdrPct = Number(sdrFull?.comissao_pct) || 3;
  const commCloser = !isSinal && closerFull && !closerFull.is_founder ? (commBaseN * 7) / 100 : 0;
  const commSdr = !isSinal && sdrFull && !sdrFull.is_founder ? (commBaseN * sdrPct) / 100 : 0;

  const memberNames = useMemo(
    () => Object.fromEntries((members ?? []).map((m) => [m.id, m.nome])),
    [members],
  );

  // Mês corrente (mesma lógica do card "Vendas fechadas este mês" do Dashboard)
  const { mesFrom, mesTo } = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const y = d.getFullYear();
    const m = d.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    return { mesFrom: `${y}-${p(m + 1)}-01`, mesTo: `${y}-${p(m + 1)}-${p(last)}` };
  }, []);

  const { data: vendas } = useQuery({
    queryKey: ["vendas", "recent", mesFrom, mesTo],
    queryFn: async () => {
      const { data } = await supabase
        .from("vendas")
        .select("*")
        .gte("data", mesFrom)
        .lte("data", mesTo)
        .order("data", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const [verTodas, setVerTodas] = useState(false);
  const sinais = useMemo(() => (vendas ?? []).filter((v) => v.is_sinal), [vendas]);
  const hoje = new Date().toLocaleDateString("sv-SE");
  // Pablo e Leandro (sócios) veem todos os closers; os restantes só as próprias vendas.
  const fechadas = useMemo(
    () =>
      (vendas ?? []).filter(
        (v) => !v.is_sinal && (isSocio || (!!myMemberId && v.closer_id === myMemberId)),
      ),
    [vendas, isSocio, myMemberId],
  );

  const isRecorrente = form.forma_pagamento === "Pagamento Recorrente";
  const isKlarna = form.forma_pagamento === "Klarna";
  const parcelasN = isRecorrente ? Math.max(Number(form.parcelas) || 1, 1) : 1;
  const valorParcelaN = isRecorrente ? (Number(form.valor_parcela) || (ticketN / parcelasN)) : 0;

  const create = useMutation({
    mutationFn: async () => {
      if (form.produto === "PVE" && !["À vista", "Cartão - à vista", "Klarna"].includes(form.forma_pagamento)) {
        throw new Error("PVE só permite pagamento à vista ou Klarna.");
      }
      const payload: any = {
        call_id: form.call_id || null,
        data: form.data,
        nome_cliente: form.nome_cliente,
        email: form.email || null,
        tel: form.tel || null,
        produto: form.produto || null,
        closer_id: form.closer_id || (isSocio ? null : myMemberId),
        sdr_id: form.sdr_id || null,
        ticket: isSinal ? Number(form.ticket) || 0 : ticketN,
        pago: isSinal ? Number(form.ticket) || 0 : (isKlarna ? ticketN : Number(form.pago) || 0),
        forma_pagamento: form.forma_pagamento,
        parcelas: isSinal ? 1 : parcelasN,
        valor_parcela: isSinal ? 0 : (isRecorrente ? valorParcelaN : 0),
        notas: form.notas || null,
        link_gravacao: form.link_gravacao.trim() || null,
        is_sinal: isSinal,
        valor_total_previsto: isSinal ? totalPrevN : null,
        data_prevista_fecho: isSinal ? (form.data_prevista_fecho || null) : null,

      };

      if (editingId) {
        const { data, error } = await supabase
          .from("vendas")
          .update(payload)
          .eq("id", editingId)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error("Não foi possível editar. Só podes editar as tuas próprias vendas.");
        }
        return;
      }

      payload.created_by = profile?.profile?.id;
      const { error } = await supabase.from("vendas").insert(payload);
      if (error) throw error;

      // Se for venda recorrente parcelada, criar registo em Alunos Recorrentes
      if (!isSinal && isRecorrente) {
        const totalN = ticketN;
        const pagoN = Number(form.pago) || 0;
        const parcelas_status = Array.from({ length: parcelasN }, (_, i) => {
          const acumulado = valorParcelaN * (i + 1);
          return acumulado <= pagoN + 0.001 ? "Pago" : "Pendente";
        });
        const { error: arErr } = await supabase.from("alunos_recorrentes").insert({
          nome: form.nome_cliente,
          email: form.email || null,
          whatsapp: form.tel || null,
          data_entrada: form.data,
          valor_total: totalN,
          valor_parcela: valorParcelaN,
          parcelas: parcelasN,
          metodo_pagamento: form.forma_pagamento,
          status_pagamento: pagoN >= totalN ? "Pago" : "Em curso",
          observacao: form.notas || null,
          parcelas_status,
        });
        if (arErr) {
          console.error("[vendas] falha ao inserir em alunos_recorrentes:", arErr);
          throw new Error("Venda registada, mas falhou ao adicionar em Alunos Recorrentes: " + arErr.message);
        }
      }
    },
    onSuccess: () => {
      toast.success(
        editingId
          ? "Venda atualizada."
          : isSinal
            ? "Sinal registado."
            : isRecorrente
              ? "Venda registada e aluno adicionado a Alunos Recorrentes."
              : "Venda registada.",
      );
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["alunos_recorrentes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["closer-vendas-range"] });
      if (editingId) cancelEdit();
      else setForm({ ...form, nome_cliente: "", email: "", tel: "", produto: "", ticket: "", valor_total_previsto: "", data_prevista_fecho: "", valor_parcela: "", notas: "", pago: "", link_gravacao: "", call_id: "" });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("vendas").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Nenhuma venda foi removida. Só podes remover as tuas próprias vendas.");
    },
    onSuccess: () => {
      toast.success("Venda removida.");
      setConfirmDelete(null);
      if (editingId) cancelEdit();
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["closer-vendas-range"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const convert = useMutation({
    mutationFn: async (row: any) => {
      const parcelasStr = window.prompt("Nº de parcelas?", "1") ?? "1";
      const pagoStr = window.prompt("Valor já pago (EUR)?", String(row.valor_total_previsto ?? row.ticket)) ?? "0";
      const { error } = await (supabase.rpc as any)("convert_sinal_to_venda", {
        p_id: row.id,
        p_forma_pagamento: row.forma_pagamento,
        p_parcelas: Number(parcelasStr) || 1,
        p_pago: Number(pagoStr) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sinal convertido em venda.");
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Registar {isSinal ? "Sinal" : "Venda"}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>
          {isSinal
            ? "Sinal = valor parcial para segurar a vaga. Não conta como venda fechada até ser convertido."
            : "As comissões são calculadas automaticamente no servidor."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSinal && !isKlarna && !(Number(form.pago) > 0)) {
            toast.error("Preenche o valor recebido desta venda.");
            return;
          }
          create.mutate();
        }}
        className="eda-card grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isSinal} onChange={(e) => setIsSinal(e.target.checked)} />
              <span className="text-sm font-semibold">Apenas sinal</span>
            </label>
            <span className="text-xs" style={{ color: "var(--text3)" }}>
              {isSinal ? "O registo será gravado como “Sinal pago”." : "Venda fechada — comissões calculadas no total."}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold" htmlFor="data-venda">Data da venda</label>
            <input id="data-venda" type="date" className="eda-input" style={{ fontSize: 15, fontWeight: 600, minWidth: 170 }} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} required />
          </div>
        </div>
        <div className="md:col-span-3 pt-2 text-[11px] font-semibold uppercase tracking-[.1em]" style={{ color: "var(--text3)" }}>Informações do cliente</div>
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Cliente / Lead</label>
          <input className="eda-input mt-1" value={form.nome_cliente} onChange={(e) => setForm({ ...form, nome_cliente: e.target.value })} required />
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Email</label>
          <input type="email" className="eda-input mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Telefone</label>
          <input className="eda-input mt-1" value={form.tel} onChange={(e) => setForm({ ...form, tel: e.target.value })} />
        </div>
        <div className="md:col-span-3 pt-2 text-[11px] font-semibold uppercase tracking-[.1em]" style={{ color: "var(--text3)" }}>Informações comerciais</div>
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Closer</label>
          {isSocio ? (
            <select className="eda-input mt-1" value={form.closer_id} onChange={(e) => setForm({ ...form, closer_id: e.target.value })} required>
              <option value="">Selecionar...</option>
              {closers.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{fullById[c.id]?.is_founder ? " (Fundador)" : ""}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                className="eda-input mt-1"
                value={(form.closer_id && memberNames[form.closer_id]) || "—"}
                readOnly
                disabled
                title="Preenchido automaticamente com o teu membro"
              />
              <div className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>
                Preenchido automaticamente pelo teu utilizador.
              </div>
            </>
          )}
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>SDR</label>
          <select className="eda-input mt-1" value={form.sdr_id} onChange={(e) => setForm({ ...form, sdr_id: e.target.value })}>
            <option value="">Selecionar...</option>
            {sdrs.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}{fullById[s.id]?.is_founder ? " (Fundador)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Produto</label>
          <select className="eda-input mt-1" value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value, forma_pagamento: e.target.value === "PVE" ? "Cartão - à vista" : form.forma_pagamento, parcelas: e.target.value === "PVE" ? "1" : form.parcelas })}>
            <option value="">Selecione…</option>
            <option value="Europa Digital Academy">Europa Digital Academy</option>
            <option value="PVE">PVE</option>
          </select>
        </div>
        <div className="md:col-span-3"><label className="text-xs font-medium" htmlFor="call-venda">Call associada (opcional)</label><select id="call-venda" className="eda-input mt-1" value={form.call_id} onChange={e=>setForm({...form,call_id:e.target.value})}><option value="">Sem call associada</option>{availableCalls.filter(c=>c.closer_id===form.closer_id && c.sdr_id===form.sdr_id && (!c.venda_id || c.venda_id===editingId)).map(c=><option key={c.id} value={c.id}>{c.nome_lead} · {new Date(c.agendada_para).toLocaleString('pt-PT')}</option>)}</select></div>
        <div className="md:col-span-3 pt-2 text-[11px] font-semibold uppercase tracking-[.1em]" style={{ color: "var(--text3)" }}>Informações de pagamento</div>
        {isSinal ? (
          <>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Valor do sinal (EUR)</label>
              <input type="number" step="0.01" className="eda-input mt-1" value={form.ticket} onChange={(e) => setForm({ ...form, ticket: e.target.value })} required />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Valor total previsto (EUR)</label>
              <input type="number" step="0.01" className="eda-input mt-1" value={form.valor_total_previsto} onChange={(e) => setForm({ ...form, valor_total_previsto: e.target.value })} required />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Data prevista de fecho</label>
              <input type="date" className="eda-input mt-1" value={form.data_prevista_fecho} onChange={(e) => setForm({ ...form, data_prevista_fecho: e.target.value })} />
            </div>

          </>
        ) : (
          <>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Valor da venda (EUR)</label>
              <input type="number" step="0.01" className="eda-input mt-1" value={form.ticket} onChange={(e) => setForm({ ...form, ticket: e.target.value })} required />
            </div>
          </>
        )}
        <div>
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Método de pagamento</label>
          <select className="eda-input mt-1" value={form.forma_pagamento} onChange={(e) => setForm({ ...form, forma_pagamento: e.target.value })}>
            <option>Cartão - à vista</option>
            <option>À vista</option>
            <option>Klarna</option>
            {form.produto !== "PVE" && <><option>Pagamento Recorrente</option><option>MB Way</option><option>Dinheiro</option></>}
          </select>
        </div>

        {!isSinal && isRecorrente && (
          <>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Nº de parcelas</label>
              <input type="number" min={1} className="eda-input mt-1" value={form.parcelas} onChange={(e) => setForm({ ...form, parcelas: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Valor da parcela (EUR)</label>
              <input type="number" step="0.01" className="eda-input mt-1" value={form.valor_parcela} onChange={(e) => setForm({ ...form, valor_parcela: e.target.value })} placeholder={String((ticketN / Math.max(Number(form.parcelas)||1,1)).toFixed(2))} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Pago à entrada (EUR)</label>
              <input type="number" step="0.01" className="eda-input mt-1" value={form.pago} onChange={(e) => setForm({ ...form, pago: e.target.value })} />
            </div>
            <div className="md:col-span-3 text-xs" style={{ color: "var(--text3)" }}>
              Ao guardar, as parcelas são geradas automaticamente: a 1.ª fica paga hoje e as restantes aparecem em <strong>Pagamentos</strong> com vencimento mensal.
            </div>
          </>
        )}

        {!isSinal && isKlarna && (
          <div>
            <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Valor recebido (EUR)</label>
            <input type="number" className="eda-input mt-1" value={ticketN || ""} readOnly disabled />
            <div className="text-[10px] mt-1" style={{ color: "var(--text3)" }}>
              No Klarna o valor entra integral e à vista — preenchido com o ticket.
            </div>
          </div>
        )}

        {!isSinal && !isKlarna && !isRecorrente && (
          <div>
            <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Valor recebido (EUR) *</label>
            <input type="number" step="0.01" required className="eda-input mt-1" value={form.pago} onChange={(e) => setForm({ ...form, pago: e.target.value })} />
          </div>
        )}



        <div className="md:col-span-3">
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Link da call gravada (opcional)</label>
          <div className="flex gap-2 mt-1">
            <input
              type="url"
              placeholder="https://..."
              className="eda-input flex-1"
              value={form.link_gravacao}
              onChange={(e) => setForm({ ...form, link_gravacao: e.target.value })}
            />
            {form.link_gravacao.trim() && (
              <a
                href={form.link_gravacao.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-2 rounded whitespace-nowrap"
                style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                Ver call gravada
              </a>
            )}
          </div>
        </div>

        <div className="md:col-span-3">
          <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Notas</label>
          <textarea className="eda-input mt-1" rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </div>

        <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-lg" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
          {isSinal ? (
            <>
              <div>
                <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Sinal</div>
                <div className="text-base font-bold" style={{ color: "var(--gold)" }}>{eur(ticketN)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Total previsto</div>
                <div className="text-base font-bold">{eur(totalPrevN)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Falta pagar</div>
                <div className="text-base font-bold">{eur(Math.max(totalPrevN - ticketN, 0))}</div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Comissão Closer</div>
                <div className="text-base font-bold" style={{ color: "var(--green)" }}>{eur(commCloser)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Comissão SDR</div>
                <div className="text-base font-bold" style={{ color: "var(--green)" }}>{eur(commSdr)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold" style={{ color: "var(--text3)" }}>Valor parcela</div>
                <div className="text-base font-bold">{eur(ticketN / (Number(form.parcelas) || 1))}</div>
              </div>
            </>
          )}
          <div className="flex items-end gap-2">
            <button type="submit" className="eda-btn w-full" disabled={create.isPending}>
              {create.isPending
                ? "A guardar..."
                : editingId
                  ? "Guardar alterações"
                  : isSinal
                    ? "Registar sinal"
                    : "Registar venda"}
            </button>
            {editingId && (
              <button type="button" className="eda-btn-ghost" onClick={cancelEdit}>
                Cancelar
              </button>
            )}
          </div>
        </div>
      </form>

      {sinais.length > 0 && (
        <div className="eda-card">
          <h3 className="font-semibold mb-4">Sinais pendentes de conversão</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
                  <th className="py-2">Data</th>
                  <th>Cliente</th>
                  <th>Produto</th>
                  <th>Closer</th>
                  <th className="text-right">Sinal</th>
                  <th className="text-right">Total previsto</th>
                  <th>Fecho previsto</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sinais.map((v) => (
                  <tr key={v.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5">{fmtDate(v.data)}</td>
                    <td>{v.nome_cliente}</td>
                    <td style={{ color: "var(--text2)" }}>{v.produto || "—"}</td>
                    <td style={{ color: "var(--text2)" }}>{(v.closer_id && memberNames[v.closer_id]) || "—"}</td>
                    <td className="text-right font-semibold" style={{ color: "var(--gold)" }}>{eur(Number(v.ticket))}</td>
                    <td className="text-right">{eur(Number(v.valor_total_previsto ?? 0))}</td>
                    <td>
                      {v.data_prevista_fecho ? (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded"
                          style={
                            v.data_prevista_fecho <= hoje
                              ? { background: "color-mix(in srgb, var(--green) 18%, transparent)", color: "var(--green)" }
                              : { color: "var(--text2)" }
                          }
                        >
                          {fmtDate(v.data_prevista_fecho)}
                          {v.data_prevista_fecho <= hoje ? " · follow-up" : ""}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text3)" }}>—</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => convert.mutate(v)}
                          disabled={convert.isPending}
                          className="text-xs px-3 py-1.5 rounded"
                          style={{ background: "var(--green)", color: "var(--sidebar-bg)", fontWeight: 600 }}
                        >
                          Converter em venda
                        </button>
                        {canManage(v) && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                startEdit(v);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className="text-xs px-2 py-1 rounded"
                              style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(v)}
                              disabled={remove.isPending}
                              className="text-xs px-2 py-1 rounded"
                              style={{ color: "var(--red)", border: "1px solid var(--border)" }}
                            >
                              Apagar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="eda-card">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="font-semibold">Vendas fechadas este mês</h3>
          <span className="text-xs" style={{ color: "var(--text3)" }}>{fechadas.length} vendas</span>
        </div>
        <div className="space-y-2">
          {fechadas.slice(0, verTodas ? undefined : 6).map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between py-2 border-b last:border-0 gap-3"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{v.nome_cliente}</div>
                <div className="text-xs" style={{ color: "var(--text3)" }}>
                  {fmtDate(v.data)}
                  {v.closer_id ? ` · ${memberNames[v.closer_id] ?? ""}` : ""}
                  {v.produto ? ` · ${v.produto}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-sm font-semibold" style={{ color: "var(--green)" }}>{eur(Number(v.ticket))}</div>
                {v.link_gravacao && (
                  <a
                    href={v.link_gravacao}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-1 rounded whitespace-nowrap"
                    style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
                  >
                    Ver call gravada
                  </a>
                )}
                {canManage(v) && (
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(v)}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(v)}
                      disabled={remove.isPending}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: "var(--red)", border: "1px solid var(--border)" }}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!fechadas.length && (
            <div className="text-sm py-4" style={{ color: "var(--text3)" }}>Sem vendas este mês.</div>
          )}
        </div>
        {fechadas.length > 6 && (
          <button
            type="button"
            onClick={() => setVerTodas((s) => !s)}
            className="mt-3 w-full text-xs py-2 rounded"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)" }}
          >
            {verTodas ? "Ver menos" : `Ver mais (${fechadas.length - 6})`}
          </button>
        )}
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setConfirmDelete(null)}
        >
          <div className="eda-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg">Tem certeza?</h3>
            <p className="text-sm mt-2" style={{ color: "var(--text2)" }}>
              Vais remover permanentemente {confirmDelete.is_sinal ? "o sinal" : "a venda"} de <strong>{confirmDelete.nome_cliente}</strong> ({eur(Number(confirmDelete.ticket))}).
              As cobranças associadas e as comissões serão recalculadas.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="eda-btn-ghost" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="eda-btn"
                style={{ background: "var(--red)" }}
                disabled={remove.isPending}
                onClick={() => remove.mutate(confirmDelete.id)}
              >
                {remove.isPending ? "A remover..." : "Remover venda"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
