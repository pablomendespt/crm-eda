CREATE OR REPLACE FUNCTION public.relatorio_dia(p_dia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 hoje date := (now() AT TIME ZONE 'Europe/Lisbon')::date;
 dias text[] := ARRAY['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
 m record; r record; f record;
 txt text; sdr_lines text := ''; clo_lines text := ''; avisos text[] := '{}';
 s_m bigint := 0; s_r bigint := 0; c_c bigint := 0; c_r bigint := 0; c_n bigint := 0;
 ns_nomes text[] := '{}'; tot record; por_validar bigint := 0; atraso bigint := 0;
 sdrs jsonb := '[]'; closers jsonb := '[]'; fecho text;
 vm bigint; vr bigint; vn bigint; opcional boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Só a gerência pode gerar a mensagem do dia'; END IF;
 IF p_dia IS NULL OR p_dia > hoje THEN RAISE EXCEPTION 'Não é possível gerar a mensagem de um dia futuro'; END IF;

 FOR m IN SELECT id, nome, (is_founder AND NOT comissiona) AS opc FROM public.members WHERE ativo AND role = 'sdr' ORDER BY nome LOOP
  SELECT * INTO r FROM public.calls_resumo_total(p_dia, p_dia, m.id, NULL);
  vm := r.marcadas + r.hist_marcadas; vr := r.realizadas + r.hist_realizadas;
  s_m := s_m + vm; s_r := s_r + vr;
  IF m.opc AND vm = 0 AND vr = 0 THEN CONTINUE; END IF;
  sdr_lines := sdr_lines || E'\n• ' || m.nome || ': ' || vm || CASE WHEN vm = 1 THEN ' marcada → ' ELSE ' marcadas → ' END || vr || CASE WHEN vr = 1 THEN ' realizada' ELSE ' realizadas' END;
  sdrs := sdrs || jsonb_build_object('nome', m.nome, 'marcadas', vm, 'realizadas', vr);
 END LOOP;

 FOR m IN SELECT id, nome, (is_founder AND NOT comissiona) AS opc FROM public.members WHERE ativo AND role = 'closer' ORDER BY nome LOOP
  SELECT * INTO r FROM public.calls_resumo_total(p_dia, p_dia, NULL, m.id);
  SELECT coalesce(sum(x.vendas),0) vendas, coalesce(sum(x.bruto),0) bruto INTO f FROM public.fin_resumo_membro(p_dia, p_dia, NULL, NULL, 'closer') x WHERE x.member_id = m.id;
  vm := r.marcadas + r.hist_marcadas; vr := r.realizadas + r.hist_realizadas; vn := r.nao_compareceu + r.hist_nao_compareceu;
  c_c := c_c + vm; c_r := c_r + vr; c_n := c_n + vn;
  IF vn > 0 THEN ns_nomes := ns_nomes || m.nome; END IF;
  IF m.opc AND vm = 0 AND f.vendas = 0 THEN CONTINUE; END IF;
  clo_lines := clo_lines || E'\n• ' || m.nome || ': ' || vm || CASE WHEN vm = 1 THEN ' call · ' ELSE ' calls · ' END || vr || CASE WHEN vr = 1 THEN ' realizada · ' ELSE ' realizadas · ' END
   || vn || CASE WHEN vn > 1 THEN ' no-shows · ' ELSE ' no-show · ' END || f.vendas || CASE WHEN f.vendas = 1 THEN ' venda' ELSE ' vendas' END || ' (' || public.fmt_eur_msg(f.bruto) || ')';
  closers := closers || jsonb_build_object('nome', m.nome, 'calls', vm, 'realizadas', vr, 'noshow', vn, 'vendas', f.vendas, 'valor', f.bruto);
 END LOOP;

 SELECT * INTO tot FROM public.fin_resumo_mes(p_dia, p_dia, NULL, NULL);
 IF p_dia >= date '2026-10-15' THEN SELECT x.por_validar INTO por_validar FROM public.calls_resumo_total(p_dia, p_dia) x; END IF;
 SELECT count(*) INTO atraso FROM public.cobrancas c WHERE NOT c.pago AND c.estado = 'pendente' AND c.data < hoje;

 fecho := CASE WHEN c_r > 0 THEN round(tot.vendas::numeric * 100 / c_r)::text || '% das calls realizadas' ELSE '—' END;
 IF c_n > 0 THEN avisos := avisos || (c_n || CASE WHEN c_n = 1 THEN ' no-show (' ELSE ' no-shows (' END || array_to_string(ns_nomes, ', ') || ') → ver se entrou em recuperação'); END IF;
 IF por_validar > 0 THEN avisos := avisos || (por_validar || CASE WHEN por_validar = 1 THEN ' call por validar' ELSE ' calls por validar' END); END IF;
 IF atraso > 0 THEN avisos := avisos || (atraso || CASE WHEN atraso = 1 THEN ' parcela em atraso' ELSE ' parcelas em atraso' END); END IF;

 txt := '📊 Resumo de ' || dias[extract(dow FROM p_dia)::int + 1] || ', ' || to_char(p_dia, 'DD/MM') || E'\n\n'
  || 'SDR (calls marcadas)' || sdr_lines || E'\nTotal: ' || s_m || CASE WHEN s_m = 1 THEN ' marcada · ' ELSE ' marcadas · ' END || s_r || CASE WHEN s_r = 1 THEN E' realizada\n\n' ELSE E' realizadas\n\n' END
  || 'Closers' || clo_lines || E'\nTotal: ' || c_c || CASE WHEN c_c = 1 THEN ' call · ' ELSE ' calls · ' END || c_r || CASE WHEN c_r = 1 THEN ' realizada · ' ELSE ' realizadas · ' END
  || c_n || CASE WHEN c_n > 1 THEN ' no-shows · ' ELSE ' no-show · ' END
  || tot.vendas || CASE WHEN tot.vendas = 1 THEN ' venda · ' ELSE ' vendas · ' END || public.fmt_eur_msg(tot.bruto)
  || E'\nFecho: ' || fecho || E'\n\n'
  || E'💶 Caixa do dia\nBruto: ' || public.fmt_eur_msg(tot.bruto) || ' · Líquido: ' || public.fmt_eur_msg(tot.liquido) || E'\n\n'
  || E'⚠️ Atenção\n' || CASE WHEN cardinality(avisos) = 0 THEN '✅ Nada pendente' ELSE '• ' || array_to_string(avisos, E'\n• ') END;

 RETURN jsonb_build_object('dia', p_dia, 'texto', txt, 'sdrs', sdrs, 'closers', closers,
  'totais', jsonb_build_object('marcadas', s_m, 'sdr_realizadas', s_r, 'calls', c_c, 'realizadas', c_r, 'noshow', c_n, 'vendas', tot.vendas, 'bruto', tot.bruto, 'liquido', tot.liquido, 'por_validar', por_validar, 'parcelas_atraso', atraso));
END $function$
;

CREATE OR REPLACE FUNCTION public.set_registo_status(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_closer uuid;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('cancelado','pago_integral','recorrente') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;
  SELECT closer_id INTO v_closer FROM public.vendas WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF NOT (public.has_role(auth.uid(),'socio')
          OR (v_closer IS NOT NULL AND v_closer = public.current_member_id())) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta venda';
  END IF;
  UPDATE public.vendas SET registo_status = p_status WHERE id = p_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.tg_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_record_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := (row_to_json(OLD)->>'id')::uuid;
    v_old := to_jsonb(OLD);
    v_new := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := (row_to_json(NEW)->>'id')::uuid;
    v_old := NULL;
    v_new := to_jsonb(NEW);
  ELSE
    v_record_id := (row_to_json(NEW)->>'id')::uuid;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    -- Skip logging updates that changed nothing meaningful
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_log(
    table_name, record_id, action, actor_id, actor_member_id,
    changed_fields, old_values, new_values
  ) VALUES (
    TG_TABLE_NAME, v_record_id, TG_OP, auth.uid(), public.current_member_id(),
    NULLIF(v_changed, ARRAY[]::text[]), v_old, v_new
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_cobranca_comissao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.estado = 'pago' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'pago') THEN
    PERFORM public.fin_gerar_comissao(NEW.venda_id, NEW.id, COALESCE(NEW.pago_em, NEW.data), COALESCE(NEW.valor_recebido, NEW.valor), 'prestacao');
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_cobranca_quitar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NEW.estado='pago' AND (SELECT count(*) FROM public.cobrancas WHERE venda_id=NEW.venda_id AND estado='pago') >= (SELECT parcelas FROM public.vendas WHERE id=NEW.venda_id) AND NOT EXISTS(SELECT 1 FROM public.cobrancas WHERE venda_id=NEW.venda_id AND estado<>'pago') THEN
 UPDATE public.vendas SET status='quitada' WHERE id=NEW.venda_id AND status='ativo';
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_followup_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM public.upsert_lead_consolidado(
    v_lead.nome, v_lead.email, v_lead.tel,
    'follow_up'::public.lead_consolidado_status,
    'follow_up'::public.lead_consolidado_origem,
    v_lead.temp,
    COALESCE(v_lead.previsao, v_lead.ticket),
    NEW.scheduled_at::date,
    COALESCE(NEW.responsavel_id, v_lead.closer_id, v_lead.sdr_id),
    auth.uid(), NULL, NEW.id, NULL
  );
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_lc_hist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_nome text := public.current_member_nome(); v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO leads_consolidados_hist(lead_id, acao, para, actor_id, actor_nome)
      VALUES (NEW.id, 'criado', NEW.call_status, v_uid, v_nome);
    RETURN NEW;
  END IF;
  IF NEW.call_status IS DISTINCT FROM OLD.call_status THEN
    INSERT INTO leads_consolidados_hist(lead_id, acao, de, para, actor_id, actor_nome)
      VALUES (NEW.id, 'status', OLD.call_status, NEW.call_status, v_uid, v_nome);
  END IF;
  IF NEW.call_at IS DISTINCT FROM OLD.call_at AND OLD.call_at IS NOT NULL THEN
    INSERT INTO leads_consolidados_hist(lead_id, acao, de, para, actor_id, actor_nome)
      VALUES (NEW.id, 'reagendado', to_char(OLD.call_at AT TIME ZONE 'Europe/Lisbon','DD/MM HH24:MI'),
              to_char(NEW.call_at AT TIME ZONE 'Europe/Lisbon','DD/MM HH24:MI'), v_uid, v_nome);
  END IF;
  IF NEW.responsavel_member_id IS DISTINCT FROM OLD.responsavel_member_id THEN
    INSERT INTO leads_consolidados_hist(lead_id, acao, de, para, actor_id, actor_nome)
      VALUES (NEW.id, 'closer', (SELECT nome FROM members WHERE id = OLD.responsavel_member_id),
              (SELECT nome FROM members WHERE id = NEW.responsavel_member_id), v_uid, v_nome);
  END IF;
  IF NEW.valor_sinal IS DISTINCT FROM OLD.valor_sinal THEN
    INSERT INTO leads_consolidados_hist(lead_id, acao, de, para, actor_id, actor_nome)
      VALUES (NEW.id, 'sinal', OLD.valor_sinal::text, NEW.valor_sinal::text, v_uid, v_nome);
  END IF;
  IF NEW.proximo_followup IS DISTINCT FROM OLD.proximo_followup AND NEW.proximo_followup IS NOT NULL THEN
    INSERT INTO leads_consolidados_hist(lead_id, acao, para, actor_id, actor_nome)
      VALUES (NEW.id, 'followup', to_char(NEW.proximo_followup,'DD/MM/YYYY'), v_uid, v_nome);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_metas_itens_hist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.metas_itens;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.alvo IS NOT DISTINCT FROM OLD.alvo
     AND NEW.bonus IS NOT DISTINCT FROM OLD.bonus
     AND NEW.label IS NOT DISTINCT FROM OLD.label
     AND NEW.ativo IS NOT DISTINCT FROM OLD.ativo THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.metas_itens_hist(
    meta_id, acao, papel, periodo, label,
    alvo_antigo, alvo_novo, bonus_antigo, bonus_novo, actor_id, actor_nome
  ) VALUES (
    r.id, TG_OP, r.papel, r.periodo, r.label,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.alvo END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.alvo END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.bonus END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.bonus END,
    auth.uid(), public.current_member_nome()
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.tg_noshow_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.upsert_lead_consolidado(
    NEW.nome, NEW.email, NEW.tel,
    'no_show'::public.lead_consolidado_status,
    'no_show'::public.lead_consolidado_origem,
    NEW.temp, NEW.ticket, NULL,
    COALESCE(NEW.closer_id, NEW.sdr_id),
    auth.uid(), NEW.id, NULL, NULL
  );
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_venda_comissao_avista()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE f text := lower(coalesce(NEW.forma_pagamento,''));
BEGIN
  IF NEW.is_sinal OR NEW.status <> 'ativo' THEN RETURN NEW; END IF;
  IF f LIKE '%klarna%' THEN
    PERFORM public.fin_gerar_comissao(NEW.id, NULL, NEW.data, NEW.ticket, 'klarna');
  ELSIF (f LIKE '%cartão%' OR f LIKE '%cartao%') AND NEW.pago > 0 THEN
    PERFORM public.fin_gerar_comissao(NEW.id, NULL, NEW.data, NEW.ticket, 'avista');
  ELSIF NEW.parcelas <= 1 AND f <> '' AND NEW.pago > 0 THEN
    PERFORM public.fin_gerar_comissao(NEW.id, NULL, NEW.data, LEAST(NEW.pago, NEW.ticket), 'avista');
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_venda_to_cs_onboarding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cs uuid;
BEGIN
  IF NEW.is_sinal THEN RETURN NEW; END IF;

  SELECT id INTO v_cs FROM public.members WHERE nome ILIKE '%gabi%antonys%' LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cs_onboarding (
      venda_id, nome_cliente, email, tel, produto, valor, data_venda,
      closer_id, sdr_id, cs_member_id, cancelado
    ) VALUES (
      NEW.id, NEW.nome_cliente, NEW.email, NEW.tel, NEW.produto, NEW.ticket, NEW.data,
      NEW.closer_id, NEW.sdr_id, v_cs, NEW.status = 'cancelado'::public.venda_status
    )
    ON CONFLICT (venda_id) DO NOTHING;
  ELSE
    UPDATE public.cs_onboarding SET
      nome_cliente = NEW.nome_cliente,
      email = NEW.email,
      tel = NEW.tel,
      produto = NEW.produto,
      valor = NEW.ticket,
      data_venda = NEW.data,
      closer_id = NEW.closer_id,
      sdr_id = NEW.sdr_id,
      cancelado = (NEW.status = 'cancelado'::public.venda_status),
      updated_at = now()
    WHERE venda_id = NEW.id;

    IF NOT FOUND THEN
      INSERT INTO public.cs_onboarding (
        venda_id, nome_cliente, email, tel, produto, valor, data_venda,
        closer_id, sdr_id, cs_member_id, cancelado
      ) VALUES (
        NEW.id, NEW.nome_cliente, NEW.email, NEW.tel, NEW.produto, NEW.ticket, NEW.data,
        NEW.closer_id, NEW.sdr_id, v_cs, NEW.status = 'cancelado'::public.venda_status
      )
      ON CONFLICT (venda_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_venda_to_followup_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_norm text := public.normalize_tel(NEW.tel);
BEGIN
  IF NEW.is_sinal AND NEW.status <> 'cancelado'::public.venda_status THEN
    SELECT id INTO v_id FROM public.leads WHERE venda_id = NEW.id LIMIT 1;
    IF v_id IS NULL AND v_norm IS NOT NULL THEN
      SELECT id INTO v_id FROM public.leads
       WHERE venda_id IS NULL AND public.normalize_tel(tel) = v_norm
       ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.leads(nome, tel, email, closer_id, sdr_id, data_1call, call_1_at, ticket, previsao,
        sinal, deu_sinal, notas, stage, fu_estado, data_prevista_fecho, link_call, venda_id, produto, origem)
      VALUES (NEW.nome_cliente, NULLIF(NEW.tel,''), NULLIF(NEW.email,''), NEW.closer_id, NEW.sdr_id, NEW.data, NEW.data::timestamptz,
        COALESCE(NEW.valor_total_previsto, NEW.ticket, 0), 0, COALESCE(NEW.pago,0), true, NEW.notas,
        'realizado'::public.lead_stage, 'deu_sinal_sem_assinar', NEW.data_prevista_fecho, NEW.link_gravacao, NEW.id,
        NEW.produto, CASE WHEN NEW.sdr_id IS NOT NULL THEN 'sdr' ELSE NULL END);
    ELSE
      UPDATE public.leads SET
        venda_id = NEW.id,
        nome = COALESCE(NULLIF(NEW.nome_cliente,''), nome),
        tel = COALESCE(NULLIF(NEW.tel,''), tel),
        email = COALESCE(NULLIF(NEW.email,''), email),
        closer_id = COALESCE(NEW.closer_id, closer_id),
        sdr_id = COALESCE(NEW.sdr_id, sdr_id),
        data_1call = COALESCE(data_1call, NEW.data),
        call_1_at = COALESCE(call_1_at, NEW.data::timestamptz),
        produto = COALESCE(NEW.produto, produto),
        ticket = COALESCE(NEW.valor_total_previsto, NULLIF(NEW.ticket,0), ticket),
        sinal = COALESCE(NEW.pago, sinal),
        deu_sinal = true,
        data_prevista_fecho = COALESCE(NEW.data_prevista_fecho, data_prevista_fecho),
        link_call = COALESCE(NEW.link_gravacao, link_call),
        notas = COALESCE(notas, NEW.notas),
        fu_estado = CASE WHEN fu_estado IN ('em_followup','potencial','pendente_sinal','sem_resposta') THEN 'deu_sinal_sem_assinar' ELSE fu_estado END
      WHERE id = v_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_sinal AND NOT NEW.is_sinal AND NEW.status = 'ativo'::public.venda_status THEN
    UPDATE public.leads SET fu_estado = 'comprou', ticket = COALESCE(NULLIF(NEW.ticket,0), ticket) WHERE venda_id = NEW.id;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_venda_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_sinal OR NEW.status <> 'ativo'::public.venda_status THEN
    RETURN NEW;
  END IF;
  PERFORM public.upsert_lead_consolidado(
    NEW.nome_cliente, NEW.email, NEW.tel,
    'fechado'::public.lead_consolidado_status,
    'venda'::public.lead_consolidado_origem,
    NULL, NEW.ticket, NULL,
    COALESCE(NEW.closer_id, NEW.sdr_id),
    COALESCE(NEW.created_by, auth.uid()),
    NULL, NULL, NEW.id
  );
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_venda_to_registo_hist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closer_nome text;
  v_sdr_nome text;
  v_estado text;
BEGIN
  -- Sinais não entram no Registo de Vendas: apenas vendas reais (EDA ou PVE)
  IF NEW.is_sinal THEN
    DELETE FROM public.registo_vendas_hist WHERE venda_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT nome INTO v_closer_nome FROM public.members WHERE id = NEW.closer_id;
  SELECT nome INTO v_sdr_nome FROM public.members WHERE id = NEW.sdr_id;

  v_estado := public.registo_hist_estado(NEW.status::text, NEW.forma_pagamento, NEW.parcelas);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.registo_vendas_hist (
      data, nome, email, tel, closer_nome, sdr_nome, valor, pago,
      forma_pagamento, parcelas, tipo_venda, estado, venda_id, link_gravacao,
      created_by, created_at, updated_at
    ) VALUES (
      NEW.data, NEW.nome_cliente, NEW.email, NEW.tel, v_closer_nome, v_sdr_nome, NEW.ticket, NEW.pago,
      NEW.forma_pagamento, NEW.parcelas, NEW.tipo_venda, v_estado, NEW.id, NEW.link_gravacao,
      NEW.created_by, COALESCE(NEW.created_at, now()), now()
    )
    ON CONFLICT (venda_id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Upsert: cobre o caso do sinal convertido em venda (a linha antiga foi apagada)
    INSERT INTO public.registo_vendas_hist (
      data, nome, email, tel, closer_nome, sdr_nome, valor, pago,
      forma_pagamento, parcelas, tipo_venda, estado, venda_id, link_gravacao,
      created_by, created_at, updated_at
    ) VALUES (
      NEW.data, NEW.nome_cliente, NEW.email, NEW.tel, v_closer_nome, v_sdr_nome, NEW.ticket, NEW.pago,
      NEW.forma_pagamento, NEW.parcelas, NEW.tipo_venda, v_estado, NEW.id, NEW.link_gravacao,
      NEW.created_by, COALESCE(NEW.created_at, now()), now()
    )
    ON CONFLICT (venda_id) DO UPDATE SET
      data = EXCLUDED.data,
      nome = EXCLUDED.nome,
      email = EXCLUDED.email,
      tel = EXCLUDED.tel,
      closer_nome = EXCLUDED.closer_nome,
      sdr_nome = EXCLUDED.sdr_nome,
      valor = EXCLUDED.valor,
      pago = EXCLUDED.pago,
      forma_pagamento = EXCLUDED.forma_pagamento,
      parcelas = EXCLUDED.parcelas,
      tipo_venda = EXCLUDED.tipo_venda,
      link_gravacao = EXCLUDED.link_gravacao,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_vendas_sinal_hist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' then
    if old.is_sinal and not new.is_sinal then
      insert into public.vendas_sinal_hist(venda_id,nome_cliente,closer_id,sdr_id,produto,data_sinal,sinal_recebido,valor_total_previsto,data_prevista_fecho,resultado,valor_final)
      values (old.id,old.nome_cliente,old.closer_id,old.sdr_id,old.produto,old.data,old.ticket,old.valor_total_previsto,old.data_prevista_fecho,'fechado',new.ticket);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.is_sinal then
      insert into public.vendas_sinal_hist(venda_id,nome_cliente,closer_id,sdr_id,produto,data_sinal,sinal_recebido,valor_total_previsto,data_prevista_fecho,resultado,valor_final)
      values (old.id,old.nome_cliente,old.closer_id,old.sdr_id,old.produto,old.data,old.ticket,old.valor_total_previsto,old.data_prevista_fecho,'cancelado',null);
    end if;
    return old;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.upsert_lead_consolidado(p_nome text, p_email text, p_tel text, p_status lead_consolidado_status, p_origem lead_consolidado_origem, p_temp lead_temp, p_preco numeric, p_data_prevista date, p_responsavel_member uuid, p_created_by uuid, p_source_noshow uuid, p_source_followup uuid, p_source_venda uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_norm text := public.normalize_tel(p_tel);
  v_email text := NULLIF(lower(trim(p_email)),'');
BEGIN
  -- find existing by email
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads_consolidados WHERE lower(email) = v_email LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_norm IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads_consolidados WHERE public.normalize_tel(telefone) = v_norm LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.leads_consolidados(
      nome, email, telefone, status, origem, temperatura, preco,
      data_prevista_fechamento, responsavel_member_id, created_by,
      source_noshow_id, source_followup_id, source_venda_id, status_changed_at
    ) VALUES (
      p_nome, NULLIF(p_email,''), NULLIF(p_tel,''), p_status, p_origem,
      p_temp, p_preco, p_data_prevista, p_responsavel_member, p_created_by,
      p_source_noshow, p_source_followup, p_source_venda, now()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.leads_consolidados SET
      nome = COALESCE(NULLIF(p_nome,''), nome),
      email = COALESCE(NULLIF(p_email,''), email),
      telefone = COALESCE(NULLIF(p_tel,''), telefone),
      status = p_status,
      origem = p_origem,
      temperatura = COALESCE(p_temp, temperatura),
      preco = COALESCE(p_preco, preco),
      data_prevista_fechamento = CASE WHEN p_status='follow_up' THEN COALESCE(p_data_prevista, data_prevista_fechamento) ELSE data_prevista_fechamento END,
      responsavel_member_id = COALESCE(p_responsavel_member, responsavel_member_id),
      source_noshow_id = COALESCE(p_source_noshow, source_noshow_id),
      source_followup_id = COALESCE(p_source_followup, source_followup_id),
      source_venda_id = COALESCE(p_source_venda, source_venda_id),
      status_changed_at = now()
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.vendas_calc_comissao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closer public.members;
  v_sdr public.members;
  v_pct_sdr numeric;
BEGIN
  IF NEW.is_sinal THEN
    NEW.comissao_closer := 0;
    NEW.comissao_sdr := 0;
    NEW.valor_parcela := 0;
    NEW.parcelas := 1;
    NEW.status := 'sinal_pago'::public.venda_status;
    RETURN NEW;
  END IF;

  IF NEW.closer_id IS NOT NULL THEN
    SELECT * INTO v_closer FROM public.members WHERE id = NEW.closer_id;
    IF v_closer.is_founder THEN
      NEW.comissao_closer := 0;
    ELSE
      NEW.comissao_closer := ROUND((NEW.ticket * 7 / 100)::numeric, 2);
    END IF;
  END IF;

  IF NEW.sdr_id IS NOT NULL THEN
    SELECT * INTO v_sdr FROM public.members WHERE id = NEW.sdr_id;
    IF v_sdr.is_founder THEN
      NEW.comissao_sdr := 0;
    ELSE
      -- percentagem definida na ficha do membro; 3% por omissão
      v_pct_sdr := COALESCE(NULLIF(v_sdr.comissao_pct, 0), 3);
      NEW.comissao_sdr := ROUND((NEW.ticket * v_pct_sdr / 100)::numeric, 2);
    END IF;
  END IF;

  IF NEW.parcelas > 0 AND NEW.valor_parcela = 0 THEN
    NEW.valor_parcela := ROUND((NEW.ticket / NEW.parcelas)::numeric, 2);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.vendas_generate_cobrancas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i int; vp numeric; ult numeric; f text := NEW.forma_pagamento;
BEGIN
  IF NEW.is_sinal THEN RETURN NEW; END IF;
  IF f = 'Pagamento Recorrente' AND NEW.parcelas > 1 THEN
    vp := round(COALESCE(NULLIF(NEW.valor_parcela,0), NEW.ticket / NEW.parcelas), 2);
    ult := CASE WHEN abs(vp * NEW.parcelas - NEW.ticket) < 0.05 THEN NEW.ticket - vp * (NEW.parcelas - 1) ELSE vp END;
    FOR i IN 1..NEW.parcelas LOOP
      INSERT INTO public.cobrancas(venda_id, nome, tel, email, valor, parcela_num, total_parcelas, data, pago, pago_em, valor_recebido, estado)
      VALUES (NEW.id, NEW.nome_cliente, NEW.tel, NEW.email,
              CASE WHEN i = NEW.parcelas THEN ult ELSE vp END,
              i, NEW.parcelas, (NEW.data + ((i-1) || ' months')::interval)::date,
              i = 1, CASE WHEN i = 1 THEN NEW.data END, CASE WHEN i = 1 THEN vp END,
              CASE WHEN i = 1 THEN 'pago' ELSE 'pendente' END);
    END LOOP;
  ELSIF f IN ('À vista', 'Cartão - à vista', 'Klarna', 'MB Way', 'Dinheiro') THEN
    INSERT INTO public.cobrancas(venda_id, nome, tel, email, valor, parcela_num, total_parcelas, data, pago, pago_em, valor_recebido, estado)
    VALUES (NEW.id, NEW.nome_cliente, NEW.tel, NEW.email, NEW.ticket, 1, 1, NEW.data, true, NEW.data, NEW.ticket, 'pago');
  ELSE
    RAISE EXCEPTION 'Forma de pagamento inválida: % (use À vista, Cartão - à vista, Klarna, MB Way, Dinheiro ou Pagamento Recorrente com mais de 1 parcela)', COALESCE(f, 'vazia');
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.vendas_protect_fin_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL OR public.is_fin_admin() THEN RETURN NEW; END IF;
 IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id OR NEW.ticket IS DISTINCT FROM OLD.ticket OR NEW.pago IS DISTINCT FROM OLD.pago OR NEW.parcelas IS DISTINCT FROM OLD.parcelas OR NEW.valor_parcela IS DISTINCT FROM OLD.valor_parcela OR NEW.forma_pagamento IS DISTINCT FROM OLD.forma_pagamento THEN RAISE EXCEPTION 'Só a gerência pode alterar pagamentos, valores ou SDR atribuído'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT (pg_trigger_depth()>1 AND OLD.status='ativo' AND NEW.status='quitada' AND (SELECT count(*) FROM cobrancas WHERE venda_id=NEW.id AND estado='pago')>=NEW.parcelas AND NOT EXISTS(SELECT 1 FROM cobrancas WHERE venda_id=NEW.id AND estado<>'pago')) THEN RAISE EXCEPTION 'Só a gerência pode alterar o estado da venda'; END IF;
 END IF;
 RETURN NEW;
END $function$
;

