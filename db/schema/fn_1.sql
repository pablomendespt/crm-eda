CREATE OR REPLACE FUNCTION public.crm2_recordes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb := '{}'::jsonb; x record;
begin
  if auth.uid() is null then return r; end if;

  select v.ticket val, v.data, m.nome, m.id mid into x from vendas v join members m on m.id=v.closer_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' order by v.ticket desc, v.data asc limit 1;
  if found then r := r || jsonb_build_object('maior_venda', jsonb_build_object('valor',x.val,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  select v.closer_id mid, m.nome, date_trunc('month',v.data)::date mes, sum(v.ticket) s, count(*) n into x from vendas v join members m on m.id=v.closer_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 order by sum(v.ticket) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('closer_melhor_mes', jsonb_build_object('valor',x.s,'data',x.mes,'nome',x.nome,'member_id',x.mid,'extra',x.n)); end if;

  select v.closer_id mid, m.nome, date_trunc('month',v.data)::date mes, count(*) n, sum(v.ticket) s into x from vendas v join members m on m.id=v.closer_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 order by count(*) desc, sum(v.ticket) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('closer_vendas_mes', jsonb_build_object('valor',x.n,'data',x.mes,'nome',x.nome,'member_id',x.mid,'extra',x.s)); end if;

  select v.closer_id mid, m.nome, v.data, count(*) n, sum(v.ticket) s into x from vendas v join members m on m.id=v.closer_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 order by count(*) desc, sum(v.ticket) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('closer_vendas_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid,'extra',x.s)); end if;

  select v.closer_id mid, m.nome, v.data, sum(v.ticket) s, count(*) n into x from vendas v join members m on m.id=v.closer_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 order by sum(v.ticket) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('closer_maior_dia', jsonb_build_object('valor',x.s,'data',x.data,'nome',x.nome,'member_id',x.mid,'extra',x.n)); end if;

  select v.closer_id mid, m.nome, date_trunc('month',v.data)::date mes, sum(v.pago) s into x from vendas v join members m on m.id=v.closer_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 having sum(v.pago)>0 order by sum(v.pago) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('closer_caixa_mes', jsonb_build_object('valor',x.s,'data',x.mes,'nome',x.nome,'member_id',x.mid)); end if;

  select v.closer_id mid, m.nome, date_trunc('month',v.data)::date mes, count(*) n into x from vendas v join members m on m.id=v.closer_id
    where coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 order by count(*) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('closer_sinais_mes', jsonb_build_object('valor',x.n,'data',x.mes,'nome',x.nome,'member_id',x.mid)); end if;

  select v.sdr_id mid, m.nome, date_trunc('month',v.data)::date mes, count(*) n, sum(v.ticket) s into x from vendas v join members m on m.id=v.sdr_id
    where v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and m.nome <> 'Isaac' group by 1,2,3 order by count(*) desc, sum(v.ticket) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('sdr_vendas_mes', jsonb_build_object('valor',x.n,'data',x.mes,'nome',x.nome,'member_id',x.mid,'extra',x.s)); end if;

  select c.member_id mid, m.nome, c.data, c.calls_realizadas n into x from closer_daily c join members m on m.id=c.member_id
    where c.calls_realizadas > 0 and m.nome <> 'Isaac' order by c.calls_realizadas desc, c.data asc limit 1;
  if found then r := r || jsonb_build_object('closer_calls_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  select s.member_id mid, m.nome, s.data, s.calls_marcadas n into x from sdr_daily s join members m on m.id=s.member_id
    where s.calls_marcadas > 0 and m.nome <> 'Isaac' order by s.calls_marcadas desc, s.data asc limit 1;
  if found then r := r || jsonb_build_object('sdr_marcadas_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  select s.member_id mid, m.nome, date_trunc('month',s.data)::date mes, sum(s.calls_marcadas) n into x from sdr_daily s join members m on m.id=s.member_id
    where m.nome <> 'Isaac' group by 1,2,3 having sum(s.calls_marcadas) > 0 order by sum(s.calls_marcadas) desc, 3 asc limit 1;
  if found then r := r || jsonb_build_object('sdr_marcadas_mes', jsonb_build_object('valor',x.n,'data',x.mes,'nome',x.nome,'member_id',x.mid)); end if;

  select s.member_id mid, m.nome, s.data, s.calls_realizadas n into x from sdr_daily s join members m on m.id=s.member_id
    where s.calls_realizadas > 0 and m.nome <> 'Isaac' order by s.calls_realizadas desc, s.data asc limit 1;
  if found then r := r || jsonb_build_object('sdr_realizadas_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  select s.member_id mid, m.nome, s.data, s.ligacoes_feitas n into x from sdr_daily s join members m on m.id=s.member_id
    where s.ligacoes_feitas > 0 and m.nome <> 'Isaac' order by s.ligacoes_feitas desc, s.data asc limit 1;
  if found then r := r || jsonb_build_object('sdr_ligacoes_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  select s.member_id mid, m.nome, s.data, s.conversas_iniciadas n into x from sdr_daily s join members m on m.id=s.member_id
    where s.conversas_iniciadas > 0 and m.nome <> 'Isaac' order by s.conversas_iniciadas desc, s.data asc limit 1;
  if found then r := r || jsonb_build_object('sdr_conversas_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  select s.member_id mid, m.nome, s.data, s.leads_qualificados n into x from sdr_daily s join members m on m.id=s.member_id
    where s.leads_qualificados > 0 and m.nome <> 'Isaac' order by s.leads_qualificados desc, s.data asc limit 1;
  if found then r := r || jsonb_build_object('sdr_qualificados_dia', jsonb_build_object('valor',x.n,'data',x.data,'nome',x.nome,'member_id',x.mid)); end if;

  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm2_serie(p_from date, p_to date)
 RETURNS TABLE(dia date, bruto numeric, vendas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d::date, coalesce(sum(v.ticket),0), count(v.id)
  from generate_series(p_from, p_to, interval '1 day') d
  left join vendas v on v.data = d::date and v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false)
    and lower(trim(coalesce(v.produto,''))) <> 'pve'
  where auth.uid() is not null
  group by d order by d
$function$
;

CREATE OR REPLACE FUNCTION public.crm2_set_foto(p_member uuid, p_foto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  if not (has_role(auth.uid(),'socio'::app_role) or p_member = current_member_id()) then
    raise exception 'Só podes mudar a tua própria foto.';
  end if;
  if p_foto is not null and length(p_foto) > 400000 then raise exception 'Foto demasiado grande.'; end if;
  update members set foto_url = p_foto where id = p_member;
end $function$
;

CREATE OR REPLACE FUNCTION public.current_member_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT member_id FROM public.profiles WHERE id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.current_member_nome()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.nome FROM public.profiles p JOIN public.members m ON m.id = p.member_id
  WHERE p.id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.fin_alterar_valor_venda(p_venda uuid, p_novo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vendas; pago_tot numeric; npend int; cada numeric;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  SELECT COALESCE(SUM(COALESCE(valor_recebido,valor)),0) INTO pago_tot FROM public.cobrancas WHERE venda_id = p_venda AND estado = 'pago';
  SELECT count(*) INTO npend FROM public.cobrancas WHERE venda_id = p_venda AND estado = 'pendente';
  IF p_novo < pago_tot THEN RAISE EXCEPTION 'O novo valor é menor do que o já recebido'; END IF;
  IF npend > 0 THEN
    cada := round((p_novo - pago_tot) / npend, 2);
    UPDATE public.cobrancas SET valor = cada WHERE venda_id = p_venda AND estado = 'pendente';
  END IF;
  UPDATE public.vendas SET ticket = p_novo WHERE id = p_venda;
  INSERT INTO public.fin_hist(venda_id, acao, de, para, valor, actor_id, actor_nome)
  VALUES (p_venda, 'valor_venda', v.ticket::text, p_novo::text, p_novo, auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_alterar_vencimento(p_cobranca uuid, p_data date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.cobrancas;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Data obrigatória'; END IF;
  SELECT * INTO c FROM public.cobrancas WHERE id = p_cobranca FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prestação não encontrada'; END IF;
  IF c.estado = 'pago' THEN RAISE EXCEPTION 'Não é possível alterar uma prestação paga'; END IF;
  UPDATE public.cobrancas SET data = p_data WHERE id = p_cobranca;
  INSERT INTO public.fin_hist(venda_id, cobranca_id, acao, de, para, actor_id, actor_nome)
  VALUES (c.venda_id, c.id, 'vencimento', to_char(c.data,'DD/MM/YYYY'), to_char(p_data,'DD/MM/YYYY'), auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_anual(p_ano integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH m AS (SELECT * FROM public.fin_mensal(p_ano))
 SELECT jsonb_build_object('meses',(SELECT jsonb_agg(to_jsonb(m) ORDER BY mes) FROM m),
  'bruto',coalesce(sum(bruto),0),'liquido',coalesce(sum(liquido),0),'caixa_total',coalesce(sum(caixa_total),0),'vendas',coalesce(sum(vendas),0),
  'media',coalesce(avg(bruto) FILTER (WHERE coalesce(bruto,0)>0),0),'melhor',coalesce(max(bruto),0),
  'melhor_mes',(SELECT mes FROM m WHERE bruto>0 ORDER BY bruto DESC LIMIT 1)) FROM m
$function$
;

CREATE OR REPLACE FUNCTION public.fin_cancelar_venda(p_venda uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vendas; n int;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v.status = 'cancelado' THEN RAISE EXCEPTION 'Venda já cancelada'; END IF;
  UPDATE public.cobrancas SET estado = 'cancelado' WHERE venda_id = p_venda AND estado = 'pendente';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.vendas SET status = 'cancelado' WHERE id = p_venda;
  INSERT INTO public.fin_hist(venda_id, acao, de, para, valor, actor_id, actor_nome)
  VALUES (p_venda, 'cancelar_venda', v.status::text, 'cancelado', n, auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_comissoes_detalhe(p_member uuid, p_from date, p_to date)
 RETURNS TABLE(id uuid, data date, papel text, venda_id uuid, aluno text, produto text, parcela text, base numeric, pct numeric, valor numeric, origem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.data, c.papel, c.venda_id, v.nome_cliente, v.produto,
         CASE WHEN cb.id IS NULL THEN '-' ELSE cb.parcela_num || '/' || cb.total_parcelas END,
         c.base, c.pct, c.valor, c.origem
  FROM public.comissoes c JOIN public.vendas v ON v.id = c.venda_id
  LEFT JOIN public.cobrancas cb ON cb.id = c.cobranca_id
  WHERE c.member_id = p_member AND c.data BETWEEN p_from AND p_to
    AND (public.is_fin_admin() OR p_member = public.current_member_id())
  ORDER BY c.data, v.nome_cliente
$function$
;

CREATE OR REPLACE FUNCTION public.fin_comparativo()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH bounds AS (SELECT coalesce(date_trunc('month',min(data))::date,date_trunc('month',CURRENT_DATE)::date) f FROM public.fin_visible_vendas(NULL,NULL) WHERE NOT is_sinal)
 SELECT jsonb_build_object('meses',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY inicio),'[]'::jsonb) FROM bounds b CROSS JOIN LATERAL public.fin_series(b.f,(date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,'month') s),'closers',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) FROM bounds b CROSS JOIN LATERAL public.fin_resumo_membro(b.f,CURRENT_DATE,NULL,NULL,'closer') m),'sdrs',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) FROM bounds b CROSS JOIN LATERAL public.fin_resumo_membro(b.f,CURRENT_DATE,NULL,NULL,'sdr') m))
$function$
;

CREATE OR REPLACE FUNCTION public.fin_comparativo(p_ano integer, p_mes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH b AS (SELECT CASE WHEN p_mes IS NULL THEN make_date(p_ano,1,1) ELSE make_date(p_ano,p_mes,1) END f,
   CASE WHEN p_mes IS NULL THEN make_date(p_ano,12,31) ELSE (make_date(p_ano,p_mes,1)+interval '1 month - 1 day')::date END t)
 SELECT jsonb_build_object(
  'meses',(SELECT jsonb_agg(to_jsonb(m) ORDER BY mes) FROM public.fin_mensal(p_ano) m WHERE p_mes IS NULL OR extract(month FROM m.mes)=p_mes),
  'closers',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM b, public.fin_ranking(b.f,b.t,'closer') r),
  'sdrs',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM b, public.fin_ranking(b.f,b.t,'sdr') r))
$function$
;

CREATE OR REPLACE FUNCTION public.fin_corte_registo()
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT DATE '2026-07-01' $function$
;

CREATE OR REPLACE FUNCTION public.fin_decidir_ajuste(p_id uuid, p_decisao text, p_valor numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a public.fin_ajustes; val numeric;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO a FROM public.fin_ajustes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ajuste não encontrado'; END IF;
  IF p_decisao NOT IN ('aplicar','parcial','nao_aplicar') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
  val := CASE p_decisao WHEN 'aplicar' THEN a.ajuste_sugerido WHEN 'parcial' THEN abs(COALESCE(p_valor,0)) ELSE 0 END;
  UPDATE public.fin_ajustes SET decisao = p_decisao, valor_ajuste = -val,
    mes_ajuste = date_trunc('month', (now() AT TIME ZONE 'Europe/Lisbon'))::date,
    decided_by = auth.uid(), decided_at = now() WHERE id = p_id;
  INSERT INTO public.fin_hist(venda_id, acao, de, para, valor, actor_id, actor_nome)
  VALUES (a.venda_id, 'ajuste_comissao', a.decisao, p_decisao, -val, auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_dias_cancelamento()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT dias_cancelamento FROM public.fin_config WHERE id = 1), 40)
$function$
;

CREATE OR REPLACE FUNCTION public.fin_escala_gabriel(p_from date, p_to date)
 RETURNS TABLE(base numeric, pct numeric, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT COALESCE(sum(COALESCE(c.valor_recebido,c.valor)),0) AS base
    FROM public.cobrancas c JOIN public.vendas v ON v.id = c.venda_id
    JOIN public.members m ON m.id = v.closer_id
    WHERE m.na_escala_gabriel AND v.data BETWEEN p_from AND p_to AND NOT v.is_sinal
      AND lower(coalesce(v.produto,'')) <> 'pve'
      AND c.estado = 'pago' AND c.pago_em BETWEEN p_from AND p_to
  )
  SELECT base, public.fin_faixa_gabriel(base), round(base * public.fin_faixa_gabriel(base) / 100, 2) FROM b
  WHERE public.is_fin_admin()
$function$
;

CREATE OR REPLACE FUNCTION public.fin_faixa_gabriel(p_base numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_base >= 9000 THEN 5 WHEN p_base >= 7000 THEN 4 WHEN p_base >= 5000 THEN 3 WHEN p_base >= 3500 THEN 2 ELSE 0 END::numeric
$function$
;

CREATE OR REPLACE FUNCTION public.fin_fixo_ryan_brl(p_caixa numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_caixa > 7000 THEN NULL WHEN p_caixa >= 5000 THEN 2000 ELSE 1500 END::numeric
$function$
;

CREATE OR REPLACE FUNCTION public.fin_fixo_ryan_eur(p_caixa numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_caixa > 7000 THEN 497 END::numeric
$function$
;

CREATE OR REPLACE FUNCTION public.fin_fixos_mes(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, nome text, regra text, caixa_proprio numeric, valor_brl numeric, valor_eur_fixo numeric, pago_brl numeric, cotacao numeric, pago_eur numeric, data_pagamento date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.nome, fr.regra, COALESCE(rm.liquido,0),
    CASE WHEN fr.regra = 'ryan' THEN public.fin_fixo_ryan_brl(COALESCE(rm.liquido,0)) ELSE fr.valor_brl END,
    CASE WHEN fr.regra = 'ryan' THEN public.fin_fixo_ryan_eur(COALESCE(rm.liquido,0)) END,
    fp.valor_brl, fp.cotacao, fp.valor_eur, fp.data_pagamento
  FROM public.members m
  JOIN public.fixos_regras fr ON fr.member_id = m.id
  LEFT JOIN public.fin_resumo_membro(p_from, p_to) rm ON rm.member_id = m.id
  LEFT JOIN public.fixos_pagamentos fp ON fp.member_id = m.id AND fp.mes = p_from
  WHERE public.is_fin_admin() OR m.id = public.current_member_id()
$function$
;

CREATE OR REPLACE FUNCTION public.fin_gerar_comissao(p_venda uuid, p_cobranca uuid, p_data date, p_base numeric, p_origem text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vendas; pc numeric; desde date;
BEGIN
  IF coalesce(p_base,0) <= 0 THEN RETURN; END IF;
  SELECT * INTO v FROM public.vendas WHERE id = p_venda;
  IF NOT FOUND OR v.is_sinal OR v.status NOT IN ('ativo','quitada') THEN RETURN; END IF;
  SELECT comissao_desde INTO desde FROM public.fin_config WHERE id = 1;
  IF v.data < coalesce(desde, DATE '2026-09-01') THEN RETURN; END IF;
  IF v.closer_id IS NOT NULL THEN
    pc := public.fin_pct(v.closer_id, 'closer', v.produto);
    IF pc > 0 THEN
      INSERT INTO public.comissoes(member_id,papel,venda_id,cobranca_id,data,base,pct,valor,origem)
      VALUES (v.closer_id,'closer',v.id,p_cobranca,p_data,p_base,pc,round(p_base*pc/100,2),p_origem) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF v.sdr_id IS NOT NULL AND v.sdr_id IS DISTINCT FROM v.closer_id THEN
    pc := public.fin_pct(v.sdr_id, 'sdr', v.produto);
    IF pc > 0 THEN
      INSERT INTO public.comissoes(member_id,papel,venda_id,cobranca_id,data,base,pct,valor,origem)
      VALUES (v.sdr_id,'sdr',v.id,p_cobranca,p_data,p_base,pc,round(p_base*pc/100,2),p_origem) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_mensal(p_ano integer)
 RETURNS TABLE(mes date, bruto numeric, liquido numeric, recorrencia numeric, caixa_total numeric, vendas bigint, origem text, futuro boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH ms AS (SELECT d::date m,(d+interval '1 month - 1 day')::date f FROM generate_series(make_date(p_ano,1,1),make_date(p_ano,12,1),interval '1 month') d)
 SELECT ms.m,
  CASE WHEN fut THEN NULL ELSE r.bruto END, CASE WHEN fut THEN NULL ELSE r.liquido END, CASE WHEN fut THEN NULL ELSE r.recorrencia END,
  CASE WHEN fut THEN NULL ELSE r.liquido+coalesce(r.recorrencia,0) END, CASE WHEN fut THEN NULL ELSE r.vendas END, r.origem, fut
 FROM ms CROSS JOIN LATERAL (SELECT ms.m>date_trunc('month',CURRENT_DATE)::date fut) x
 CROSS JOIN LATERAL (
  SELECT h.bruto,h.liquido,NULL::numeric recorrencia,h.vendas,'registo'::text origem FROM (
   SELECT coalesce(sum(valor),0) bruto,coalesce(sum(pago),0) liquido,count(*) vendas FROM public.registo_vendas_hist rv
   WHERE rv.data BETWEEN ms.m AND ms.f AND lower(trim(rv.produto))<>'pve' AND rv.estado<>'cancelado'
    AND auth.uid() IS NOT NULL AND (public.is_fin_admin() OR public.has_role(auth.uid(),'socio') OR rv.closer_nome=public.current_member_nome() OR rv.sdr_nome=public.current_member_nome())) h
  WHERE ms.m<public.fin_corte_registo()
  UNION ALL
  SELECT s.bruto,s.liquido,s.recorrencia,s.vendas,'vendas' FROM public.fin_resumo_mes(ms.m,ms.f,NULL::text,NULL::uuid) s WHERE ms.m>=public.fin_corte_registo()
 ) r ORDER BY ms.m
$function$
;

CREATE OR REPLACE FUNCTION public.fin_metas_mes(p_mes date)
 RETURNS TABLE(id uuid, metrica text, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT m.id,m.metrica,m.valor FROM public.metas_config m WHERE auth.uid() IS NOT NULL AND m.ativo AND m.papel='equipa' AND m.periodo='mensal' AND m.member_id IS NULL AND (m.mes=date_trunc('month',p_mes)::date OR m.mes IS NULL)
 ORDER BY m.mes NULLS LAST
$function$
;

CREATE OR REPLACE FUNCTION public.fin_metas_mes_detalhe(p_mes date)
 RETURNS TABLE(id uuid, metrica text, valor numeric, mes date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT m.id,m.metrica,m.valor,m.mes FROM public.metas_config m WHERE auth.uid() IS NOT NULL AND m.ativo AND m.papel='equipa' AND m.periodo='mensal' AND m.member_id IS NULL AND (m.mes=date_trunc('month',p_mes)::date OR m.mes IS NULL)
 ORDER BY m.mes NULLS LAST
$function$
;

CREATE OR REPLACE FUNCTION public.fin_oportunidades(p_from date, p_to date, p_produto text DEFAULT NULL::text, p_closer uuid DEFAULT NULL::uuid)
 RETURNS TABLE(valor numeric, n bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT coalesce(sum(greatest(coalesce(l.ticket,0)-CASE WHEN l.deu_sinal OR coalesce(l.sinal,0)>0 THEN coalesce(l.sinal,0) ELSE 0 END,0)),0),count(*)
 FROM public.leads l WHERE auth.uid() IS NOT NULL
 AND (public.has_role(auth.uid(),'socio') OR public.is_fin_admin() OR l.closer_id=public.current_member_id() OR l.sdr_id=public.current_member_id())
 AND l.fu_estado NOT IN ('comprou','reembolso','perdido')
 AND (l.deu_sinal OR coalesce(l.sinal,0)>0 OR l.data_prevista_fecho BETWEEN p_from AND p_to)
 AND (p_produto IS NULL OR p_produto='' OR l.produto=p_produto) AND (p_closer IS NULL OR l.closer_id=p_closer)
$function$
;

CREATE OR REPLACE FUNCTION public.fin_pagar_fixo(p_member uuid, p_mes date, p_valor_brl numeric, p_cotacao numeric, p_valor_eur numeric, p_data date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE eur numeric;
BEGIN
  IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  eur := COALESCE(p_valor_eur, CASE WHEN p_cotacao > 0 THEN round(p_valor_brl / p_cotacao, 2) END);
  IF eur IS NULL THEN RAISE EXCEPTION 'Indique a cotação do dia (BRL por 1 EUR) ou o valor em EUR'; END IF;
  INSERT INTO public.fixos_pagamentos(member_id, mes, valor_brl, cotacao, valor_eur, data_pagamento, pago_by)
  VALUES (p_member, date_trunc('month', p_mes)::date, p_valor_brl, p_cotacao, eur, COALESCE(p_data, CURRENT_DATE), auth.uid())
  ON CONFLICT (member_id, mes) DO UPDATE SET valor_brl = EXCLUDED.valor_brl, cotacao = EXCLUDED.cotacao,
    valor_eur = EXCLUDED.valor_eur, data_pagamento = EXCLUDED.data_pagamento, pago_by = EXCLUDED.pago_by;
  INSERT INTO public.fin_hist(acao, de, para, valor, actor_id, actor_nome)
  VALUES ('fixo', (SELECT nome FROM public.members WHERE id = p_member), to_char(p_mes,'MM/YYYY') || ' cotação ' || COALESCE(p_cotacao::text,'-'), eur, auth.uid(), public.current_member_nome());
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_pct(p_member uuid, p_papel text, p_produto text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m public.members; r numeric;
BEGIN
  SELECT * INTO m FROM public.members WHERE id = p_member;
  IF NOT FOUND OR NOT m.comissiona THEN RETURN 0; END IF;
  SELECT pct INTO r FROM public.comissao_regras WHERE member_id = p_member AND ativo
    AND lower(produto) = lower(coalesce(p_produto,'')) LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT pct INTO r FROM public.comissao_regras WHERE member_id = p_member AND ativo AND produto = '*' LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;
  IF p_papel = 'sdr' THEN RETURN CASE WHEN m.comissao_pct > 0 THEN m.comissao_pct ELSE 5 END; END IF;
  RETURN 7;
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_processar_atrasos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int := 0; r record; d int := public.fin_dias_cancelamento();
BEGIN
  FOR r IN SELECT DISTINCT v.id FROM public.vendas v JOIN public.cobrancas c ON c.venda_id = v.id
           WHERE v.status = 'ativo' AND c.estado <> 'pago' AND c.data + d < CURRENT_DATE LOOP
    UPDATE public.vendas SET status = 'cancelado' WHERE id = r.id;
    INSERT INTO public.fin_hist(venda_id, acao, de, para, actor_nome)
    VALUES (r.id, 'cancelamento_automatico', 'ativo', 'cancelado', 'Sistema (' || d || ' dias sem pagamento)');
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$
;

CREATE OR REPLACE FUNCTION public.fin_ranking(p_from date, p_to date, p_papel text)
 RETURNS TABLE(member_id uuid, nome text, ativo boolean, vendas bigint, bruto numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 WITH v AS (
  SELECT CASE WHEN p_papel='sdr' THEN x.sdr_id ELSE x.closer_id END mid, NULL::text nm, x.ticket val
  FROM public.fin_visible_vendas(NULL,NULL) x
  WHERE x.data BETWEEN greatest(p_from,public.fin_corte_registo()) AND p_to AND NOT x.is_sinal AND x.status IN ('ativo','quitada')
  UNION ALL
  SELECT NULL, nullif(trim(CASE WHEN p_papel='sdr' THEN rv.sdr_nome ELSE rv.closer_nome END),''), rv.valor
  FROM public.registo_vendas_hist rv
  WHERE rv.data BETWEEN p_from AND least(p_to,public.fin_corte_registo()-1) AND lower(trim(rv.produto))<>'pve' AND rv.estado<>'cancelado'
   AND auth.uid() IS NOT NULL AND (public.is_fin_admin() OR public.has_role(auth.uid(),'socio') OR rv.closer_nome=public.current_member_nome() OR rv.sdr_nome=public.current_member_nome())),
 r AS (SELECT coalesce(v.mid,m2.id) id, coalesce(m1.nome,m2.nome,v.nm,CASE WHEN p_papel='sdr' THEN 'Sem SDR' ELSE 'Sem closer' END) n, v.val
  FROM v LEFT JOIN public.members m1 ON m1.id=v.mid
  LEFT JOIN LATERAL (SELECT id,nome FROM public.members mm WHERE v.mid IS NULL AND lower(mm.nome)=lower(v.nm) LIMIT 1) m2 ON true)
 SELECT r.id, r.n, coalesce(m.ativo,false), count(*), sum(r.val) FROM r LEFT JOIN public.members m ON m.id=r.id
 GROUP BY r.id, r.n, m.ativo ORDER BY sum(r.val) DESC
$function$
;

