CREATE OR REPLACE FUNCTION public.fin_registar_bonus(p_member uuid, p_valor numeric, p_mes date, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  INSERT INTO public.fin_ajustes(tipo, member_id, valor_ajuste, mes_ajuste, motivo, decisao, actor_id, actor_nome, decided_by, decided_at)
  VALUES (CASE WHEN p_valor >= 0 THEN 'bonus' ELSE 'ajuste' END, p_member, p_valor, date_trunc('month', p_mes)::date, p_motivo, 'aplicar', auth.uid(), public.current_member_nome(), auth.uid(), now());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_registar_cancelamento(p_venda uuid, p_tipo text, p_valor_devolvido numeric, p_motivo text, p_data date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vendas; rec numeric; r record; n int := 0;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_tipo NOT IN ('cancelamento','reembolso') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  SELECT COALESCE(SUM(COALESCE(valor_recebido, valor)),0) INTO rec FROM public.cobrancas WHERE venda_id = p_venda AND estado = 'pago';
  IF rec = 0 THEN rec := LEAST(COALESCE(v.pago,0), v.ticket); END IF;
  IF lower(coalesce(v.forma_pagamento,'')) LIKE '%klarna%' THEN rec := v.ticket; END IF;

  UPDATE public.cobrancas SET estado = 'cancelado' WHERE venda_id = p_venda AND estado = 'pendente';
  IF p_tipo = 'reembolso' AND COALESCE(p_valor_devolvido,0) >= rec AND rec > 0 THEN
    UPDATE public.cobrancas SET estado = 'reembolsado' WHERE venda_id = p_venda AND estado = 'pago';
  END IF;
  UPDATE public.vendas SET status = 'cancelado' WHERE id = p_venda;

  FOR r IN SELECT member_id, SUM(valor) AS pago FROM public.comissoes WHERE venda_id = p_venda GROUP BY member_id LOOP
    n := n + 1;
    INSERT INTO public.fin_ajustes(venda_id,tipo,data,valor_vendido,valor_recebido,valor_devolvido,motivo,member_id,comissao_paga,ajuste_sugerido,actor_id,actor_nome)
    VALUES (p_venda,p_tipo,COALESCE(p_data,CURRENT_DATE),v.ticket,rec,COALESCE(p_valor_devolvido,0),p_motivo,r.member_id,r.pago,
      CASE WHEN rec > 0 THEN round(r.pago * LEAST(COALESCE(p_valor_devolvido,0)/rec,1),2) ELSE 0 END, auth.uid(), public.current_member_nome());
  END LOOP;
  IF n = 0 THEN
    INSERT INTO public.fin_ajustes(venda_id,tipo,data,valor_vendido,valor_recebido,valor_devolvido,motivo,decisao,actor_id,actor_nome)
    VALUES (p_venda,p_tipo,COALESCE(p_data,CURRENT_DATE),v.ticket,rec,COALESCE(p_valor_devolvido,0),p_motivo,'nao_aplicar',auth.uid(),public.current_member_nome());
  END IF;
  INSERT INTO public.fin_hist(venda_id, acao, de, para, valor, actor_id, actor_nome)
  VALUES (p_venda, p_tipo, v.status::text, 'cancelado', COALESCE(p_valor_devolvido,0), auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_registar_pagamento(p_cobranca uuid, p_valor numeric, p_data date, p_metodo text, p_conta text, p_obs text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.cobrancas;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO c FROM public.cobrancas WHERE id = p_cobranca FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prestação não encontrada'; END IF;
  IF c.estado = 'pago' THEN RAISE EXCEPTION 'Esta prestação já está paga'; END IF;
  UPDATE public.cobrancas SET pago = true, estado = 'pago', pago_em = COALESCE(p_data, CURRENT_DATE),
    valor_recebido = COALESCE(p_valor, c.valor), metodo = NULLIF(p_metodo,''), conta = NULLIF(p_conta,''),
    observacao = NULLIF(p_obs,''), pago_by = auth.uid()
  WHERE id = p_cobranca;
  INSERT INTO public.fin_hist(venda_id, cobranca_id, acao, de, para, valor, actor_id, actor_nome)
  VALUES (c.venda_id, c.id, 'pagamento', c.parcela_num || '/' || c.total_parcelas, to_char(COALESCE(p_data, CURRENT_DATE),'DD/MM/YYYY'),
    COALESCE(p_valor, c.valor), auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_membro(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, nome text, vendas bigint, bruto numeric, liquido numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT member_id,nome,vendas,bruto,liquido FROM public.fin_resumo_membro(p_from,p_to,NULL::text,NULL::uuid,'closer')
$function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_membro(p_from date, p_to date, p_produto text, p_closer uuid, p_papel text)
 RETURNS TABLE(member_id uuid, nome text, vendas bigint, bruto numeric, liquido numeric, ticket_medio numeric, sinais bigint, valor_sinais numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH scoped AS (SELECT * FROM public.fin_visible_vendas(p_produto,p_closer) WHERE data BETWEEN p_from AND p_to),
 rows AS (SELECT m.id,m.nome,
  count(v.id) FILTER(WHERE NOT v.is_sinal AND v.status IN ('ativo','quitada')) vendas,
  coalesce(sum(v.ticket) FILTER(WHERE NOT v.is_sinal AND v.status IN ('ativo','quitada')),0) bruto,
  coalesce(sum((SELECT sum(coalesce(c.valor_recebido,c.valor)) FROM public.cobrancas c WHERE c.venda_id=v.id AND c.estado='pago' AND c.pago_em BETWEEN p_from AND p_to)) FILTER(WHERE NOT v.is_sinal),0) liquido,
  count(v.id) FILTER(WHERE v.is_sinal) sinais,coalesce(sum(v.ticket) FILTER(WHERE v.is_sinal),0) valor_sinais
  FROM public.members m LEFT JOIN scoped v ON CASE WHEN p_papel='sdr' THEN v.sdr_id=m.id ELSE v.closer_id=m.id END
  WHERE (m.ativo OR v.id IS NOT NULL) AND auth.uid() IS NOT NULL AND (public.has_role(auth.uid(),'socio') OR public.is_fin_admin() OR m.id=public.current_member_id())
  GROUP BY m.id,m.nome)
 SELECT id,nome,vendas,bruto,liquido,CASE WHEN vendas>0 THEN bruto/vendas ELSE 0 END,sinais,valor_sinais FROM rows ORDER BY nome
$function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_mes(p_from date, p_to date)
 RETURNS TABLE(bruto numeric, liquido numeric, vendas bigint, recorrencia numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT bruto,liquido,vendas,recorrencia FROM public.fin_resumo_mes(p_from,p_to,NULL::text,NULL::uuid)
$function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_mes(p_from date, p_to date, p_produto text, p_closer uuid)
 RETURNS TABLE(bruto numeric, liquido numeric, vendas bigint, recorrencia numeric, ticket_medio numeric, sinais bigint, valor_sinais numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH scoped AS (SELECT * FROM public.fin_visible_vendas(p_produto,p_closer)),
 vall AS (SELECT * FROM scoped WHERE data BETWEEN p_from AND p_to AND NOT is_sinal),
 vm AS (SELECT * FROM vall WHERE status IN ('ativo','quitada')),
 totals AS (SELECT coalesce(sum(ticket),0) bruto,count(*) vendas FROM vm)
 SELECT t.bruto,
  coalesce((SELECT sum(coalesce(c.valor_recebido,c.valor)) FROM public.cobrancas c JOIN vall ON vall.id=c.venda_id WHERE c.estado='pago' AND c.pago_em BETWEEN p_from AND p_to),0),
  t.vendas,
  CASE WHEN public.has_role(auth.uid(),'socio') THEN coalesce((SELECT sum(coalesce(c.valor_recebido,c.valor)) FROM public.cobrancas c JOIN scoped v ON v.id=c.venda_id WHERE NOT v.is_sinal AND v.data<p_from AND c.estado='pago' AND c.pago_em BETWEEN p_from AND p_to),0) END,
  CASE WHEN t.vendas>0 THEN t.bruto/t.vendas ELSE 0 END,
  (SELECT count(*) FROM scoped WHERE is_sinal AND data BETWEEN p_from AND p_to),
  coalesce((SELECT sum(ticket) FROM scoped WHERE is_sinal AND data BETWEEN p_from AND p_to),0)
 FROM totals t
$function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_pendente(p_hoje date DEFAULT CURRENT_DATE)
 RETURNS TABLE(atraso numeric, a_receber numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT * FROM public.fin_resumo_pendente(p_hoje,NULL::date,NULL::date,NULL::text,NULL::uuid)
$function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_pendente(p_hoje date, p_from date, p_to date, p_produto text, p_closer uuid)
 RETURNS TABLE(atraso numeric, a_receber numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT coalesce(sum(c.valor) FILTER(WHERE c.data<p_hoje),0),coalesce(sum(c.valor) FILTER(WHERE c.data>=p_hoje),0)
 FROM public.cobrancas c JOIN public.fin_visible_vendas(p_produto,p_closer) v ON v.id=c.venda_id
 WHERE c.estado='pendente' AND NOT v.is_sinal AND v.status NOT IN ('cancelado','reembolsada')
 AND (p_from IS NULL OR v.data>=p_from) AND (p_to IS NULL OR v.data<=p_to)
$function$
;

CREATE OR REPLACE FUNCTION public.fin_resumo_pessoa(p_from date, p_to date, p_member uuid, p_papel text, p_produto text DEFAULT NULL::text)
 RETURNS TABLE(member_id uuid, nome text, vendas bigint, bruto numeric, liquido numeric, ticket_medio numeric, sinais bigint, valor_sinais numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT * FROM public.fin_resumo_membro(p_from,p_to,p_produto,NULL,p_papel) WHERE member_id=p_member
$function$
;

CREATE OR REPLACE FUNCTION public.fin_series(p_from date, p_to date, p_step text, p_produto text DEFAULT NULL::text, p_closer uuid DEFAULT NULL::uuid)
 RETURNS TABLE(inicio date, fim date, bruto numeric, liquido numeric, vendas bigint, ticket_medio numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT d::date,least(p_to,(d+CASE p_step WHEN 'month' THEN interval '1 month - 1 day' WHEN 'week' THEN interval '6 days' ELSE interval '0 days' END)::date),r.bruto,r.liquido,r.vendas,r.ticket_medio
 FROM generate_series(p_from,p_to,CASE p_step WHEN 'month' THEN interval '1 month' WHEN 'week' THEN interval '7 days' ELSE interval '1 day' END) d
 CROSS JOIN LATERAL public.fin_resumo_mes(d::date,least(p_to,(d+CASE p_step WHEN 'month' THEN interval '1 month - 1 day' WHEN 'week' THEN interval '6 days' ELSE interval '0 days' END)::date),p_produto,p_closer) r
$function$
;

CREATE OR REPLACE FUNCTION public.fin_series_membro(p_from date, p_to date, p_member uuid, p_papel text, p_produto text DEFAULT NULL::text)
 RETURNS TABLE(inicio date, bruto numeric, liquido numeric, vendas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT d::date,r.bruto,r.liquido,r.vendas FROM generate_series(p_from,p_to,interval '1 day') d
 CROSS JOIN LATERAL public.fin_resumo_pessoa(d::date,d::date,p_member,p_papel,p_produto) r
$function$
;

CREATE OR REPLACE FUNCTION public.fin_set_comissao_desde(p_data date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Data obrigatória'; END IF;
  UPDATE public.fin_config SET comissao_desde = p_data, updated_at = now() WHERE id = 1;
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_set_conta(p_venda uuid, p_conta text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_old text;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT conta_recebimento INTO v_old FROM public.vendas WHERE id = p_venda;
  UPDATE public.vendas SET conta_recebimento = NULLIF(p_conta,'') WHERE id = p_venda;
  INSERT INTO public.fin_hist(venda_id, acao, de, para, actor_id, actor_nome)
  VALUES (p_venda, 'conta', v_old, NULLIF(p_conta,''), auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_set_fixo(p_member uuid, p_valor_brl numeric, p_regra text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  INSERT INTO public.fixos_regras(member_id, valor_brl, regra) VALUES (p_member, p_valor_brl, NULLIF(p_regra,''))
  ON CONFLICT (member_id) DO UPDATE SET valor_brl = EXCLUDED.valor_brl, regra = EXCLUDED.regra, updated_at = now();
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_total_mes(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, nome text, fixo_eur numeric, fixo_pago boolean, comissoes numeric, escala numeric, bonus numeric, ajustes numeric, total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fx AS (SELECT * FROM public.fin_fixos_mes(p_from, p_to)),
  esc AS (SELECT valor FROM public.fin_escala_gabriel(p_from, p_to)),
  b AS (
    SELECT m.id, m.nome,
      (SELECT COALESCE(fx.pago_eur, fx.valor_eur_fixo) FROM fx WHERE fx.member_id = m.id) AS fixo_eur,
      EXISTS (SELECT 1 FROM fx WHERE fx.member_id = m.id AND fx.pago_eur IS NOT NULL) AS fixo_pago,
      COALESCE((SELECT sum(c.valor) FROM public.comissoes c WHERE c.member_id = m.id AND c.data BETWEEN p_from AND p_to),0) AS comissoes,
      CASE WHEN m.recebe_escala THEN COALESCE((SELECT valor FROM esc),0) ELSE 0 END AS escala,
      COALESCE((SELECT sum(a.valor_ajuste) FROM public.fin_ajustes a WHERE a.member_id = m.id AND a.tipo = 'bonus' AND a.mes_ajuste = date_trunc('month', p_from)::date),0) AS bonus,
      COALESCE((SELECT sum(a.valor_ajuste) FROM public.fin_ajustes a WHERE a.member_id = m.id AND a.tipo <> 'bonus' AND a.decisao IN ('aplicar','parcial') AND a.mes_ajuste = date_trunc('month', p_from)::date),0) AS ajustes
    FROM public.members m
    WHERE m.ativo AND (public.is_fin_admin() OR m.id = public.current_member_id())
  )
  SELECT id, nome, fixo_eur, fixo_pago, comissoes, escala, bonus, ajustes,
         COALESCE(fixo_eur,0) + comissoes + escala + bonus + ajustes
  FROM b
  WHERE fixo_eur IS NOT NULL OR comissoes <> 0 OR escala <> 0 OR bonus <> 0 OR ajustes <> 0
     OR EXISTS (SELECT 1 FROM public.fixos_regras fr WHERE fr.member_id = b.id)
  ORDER BY nome
$function$
;

CREATE OR REPLACE FUNCTION public.fin_visible_vendas(p_produto text, p_closer uuid)
 RETURNS SETOF vendas
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT v.* FROM public.vendas v WHERE auth.uid() IS NOT NULL
 AND (public.has_role(auth.uid(),'socio') OR public.is_fin_admin() OR v.closer_id=public.current_member_id() OR v.sdr_id=public.current_member_id())
 AND (p_closer IS NULL OR v.closer_id=p_closer)
 AND (CASE WHEN NULLIF(trim(p_produto),'') IS NULL THEN lower(trim(coalesce(v.produto,'')))<>'pve' ELSE lower(trim(coalesce(v.produto,'')))=lower(trim(p_produto)) END)
$function$
;

CREATE OR REPLACE FUNCTION public.fmt_eur_msg(v numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
 SELECT '€' || regexp_replace(trunc(abs(coalesce(v,0)))::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
  || CASE WHEN round(abs(coalesce(v,0)),2) <> trunc(abs(coalesce(v,0))) THEN ',' || lpad(round((round(abs(coalesce(v,0)),2) - trunc(abs(coalesce(v,0))))*100)::int::text, 2, '0') ELSE '' END
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE is_ger boolean;
BEGIN
  is_ger := EXISTS (SELECT 1 FROM public.gerencia_emails WHERE email = lower(NEW.email));
  INSERT INTO public.profiles (id, email, nome, ativo)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email,'@',1)), is_ger)
  ON CONFLICT (id) DO NOTHING;
  IF is_ger THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'socio'), (NEW.id, 'gerencia') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'sdr') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_fin_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'gerencia'::public.app_role)
$function$
;

CREATE OR REPLACE FUNCTION public.lc_sync_call_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.call_status IS NULL THEN
      NEW.call_status := CASE NEW.status::text WHEN 'no_show' THEN 'nao_compareceu' WHEN 'fechado' THEN 'fechado' ELSE 'follow_up' END;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.call_status IS NOT DISTINCT FROM OLD.call_status THEN
    IF NEW.status::text = 'fechado' THEN NEW.call_status := 'fechado';
    ELSIF NEW.status::text = 'no_show' AND COALESCE(OLD.call_status,'') <> 'fechado' THEN
      NEW.call_status := 'nao_compareceu'; NEW.noshow_count := COALESCE(OLD.noshow_count,0) + 1;
    ELSIF NEW.status::text = 'follow_up' AND COALESCE(OLD.call_status,'') IN ('', 'call_marcada','call_realizada') THEN
      NEW.call_status := 'follow_up';
    END IF;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.list_members_directory()
 RETURNS TABLE(id uuid, nome text, role text, ativo boolean, is_founder boolean, is_socio boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.nome, m.role::text, m.ativo, m.is_founder,
         EXISTS (
           SELECT 1 FROM public.profiles p
           JOIN public.user_roles ur ON ur.user_id = p.id
           WHERE p.member_id = m.id AND ur.role = 'socio'::public.app_role
         )
  FROM public.members m ORDER BY m.nome
$function$
;

CREATE OR REPLACE FUNCTION public.list_registo_vendas()
 RETURNS TABLE(id uuid, data date, nome_cliente text, email text, tel text, closer_id uuid, closer_nome text, sdr_nome text, ticket numeric, pago numeric, forma_pagamento text, parcelas integer, tipo_venda text, registo_status text, is_sinal boolean, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT v.id, v.data, v.nome_cliente, v.email, v.tel,
         v.closer_id, c.nome, s.nome,
         v.ticket, v.pago, v.forma_pagamento, v.parcelas,
         v.tipo_venda,
         COALESCE(
           v.registo_status,
           CASE
             WHEN v.status = 'cancelado'::public.venda_status THEN 'cancelado'
             WHEN v.pago >= v.ticket AND v.ticket > 0 THEN 'pago_integral'
             ELSE 'recorrente'
           END
         ),
         v.is_sinal, v.status::text
  FROM public.vendas v
  LEFT JOIN public.members c ON c.id = v.closer_id
  LEFT JOIN public.members s ON s.id = v.sdr_id
  WHERE auth.uid() IS NOT NULL
    AND (
      public.is_fin_admin()
      OR public.has_role(auth.uid(), 'socio'::app_role)
      OR (public.has_role(auth.uid(), 'closer'::app_role) AND v.closer_id = public.current_member_id())
      OR (public.has_role(auth.uid(), 'sdr'::app_role) AND v.sdr_id = public.current_member_id())
      OR (public.has_role(auth.uid(), 'cs'::app_role) AND (v.closer_id = public.current_member_id() OR v.sdr_id = public.current_member_id()))
    )
  ORDER BY v.data DESC
$function$
;

CREATE OR REPLACE FUNCTION public.metas_itens_validate_input()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF TG_OP='INSERT' OR NEW.label IS DISTINCT FROM OLD.label THEN IF nullif(trim(NEW.label),'') IS NULL OR length(NEW.label)>200 THEN RAISE EXCEPTION 'Nome da meta inválido'; END IF; END IF;
 IF TG_OP='INSERT' OR NEW.alvo IS DISTINCT FROM OLD.alvo THEN IF NEW.alvo<0 OR NEW.alvo='NaN'::numeric THEN RAISE EXCEPTION 'Alvo inválido'; END IF; END IF;
 IF TG_OP='INSERT' OR NEW.bonus IS DISTINCT FROM OLD.bonus THEN IF NEW.bonus<0 OR NEW.bonus='NaN'::numeric THEN RAISE EXCEPTION 'Bónus inválido'; END IF; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.normalize_tel(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ SELECT NULLIF(regexp_replace(COALESCE(t,''),'\D','','g'),'') $function$
;

CREATE OR REPLACE FUNCTION public.profiles_protect_sensitive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'socio'::public.app_role) AND NOT public.is_fin_admin() THEN
    NEW.ativo := OLD.ativo;
    NEW.member_id := OLD.member_id;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'socio'::public.app_role) AND NOT public.is_fin_admin() THEN
    NEW.ativo := OLD.ativo;
    NEW.member_id := OLD.member_id;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.recovery_int_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.autor_id IS NULL THEN NEW.autor_id := auth.uid(); END IF;
  IF NEW.autor_member_id IS NULL THEN NEW.autor_member_id := public.current_member_id(); END IF;
  UPDATE public.recovery_leads
    SET
      calls_reativacao = calls_reativacao + CASE WHEN NEW.canal = 'call' THEN 1 ELSE 0 END,
      followups_mensagem = followups_mensagem + CASE WHEN NEW.canal IN ('whatsapp','instagram') THEN 1 ELSE 0 END,
      ultimo_contacto_at = NEW.ocorrido_em,
      ultimo_contacto_canal = NEW.canal
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recovery_leads_track_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := now();
    NEW.status_changed_by := auth.uid();
    IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    NEW.status_changed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.registo_hist_estado(p_status text, p_forma text, p_parcelas integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status = 'cancelado' THEN 'cancelado'
    WHEN COALESCE(p_forma,'') ILIKE '%klarna%' THEN 'pago_integral'
    WHEN COALESCE(p_forma,'') ILIKE '%vista%' THEN 'pago_integral'
    WHEN COALESCE(p_parcelas,1) > 1 THEN 'recorrente'
    WHEN COALESCE(p_forma,'') ILIKE '%recorrente%' THEN 'recorrente'
    ELSE 'pago_integral'
  END
$function$
;

CREATE OR REPLACE FUNCTION public.registo_sale_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vendas;
BEGIN
 IF NEW.venda_id IS NOT NULL AND (TG_OP='INSERT' OR pg_trigger_depth()>1) THEN
 SELECT * INTO v FROM public.vendas WHERE id=NEW.venda_id;
 IF FOUND THEN NEW.produto:=coalesce(v.produto,'Europa Digital Academy'); NEW.estado:=public.registo_hist_estado(v.status::text,v.forma_pagamento,v.parcelas); END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.registo_vendas_totais(p_produto text DEFAULT NULL::text)
 RETURNS TABLE(mes text, vendas bigint, valor numeric, pago numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT to_char(data,'YYYY-MM'), count(*), coalesce(sum(valor),0), coalesce(sum(pago),0)
  FROM public.registo_vendas_hist
  WHERE p_produto IS NULL OR produto = p_produto
  GROUP BY 1 ORDER BY 1 DESC
$function$
;

