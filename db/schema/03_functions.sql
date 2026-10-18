CREATE OR REPLACE FUNCTION public.call_cancelar(p_call uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c calls%ROWTYPE;
BEGIN
 SELECT * INTO c FROM calls WHERE id=p_call FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT(public.is_fin_admin() OR (public.has_role(auth.uid(),'sdr') AND c.sdr_id=public.current_member_id())) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 IF c.estado<>'agendada' OR c.agendada_para<=now() THEN RAISE EXCEPTION 'Só podes cancelar calls futuras agendadas'; END IF;
 UPDATE calls SET estado='cancelada',validada_em=now(),validada_por=auth.uid() WHERE id=p_call;
END $function$
;

CREATE OR REPLACE FUNCTION public.call_ligar_venda(p_call uuid, p_venda uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c calls%ROWTYPE; v vendas%ROWTYPE;
BEGIN
 SELECT * INTO c FROM calls WHERE id=p_call FOR UPDATE;
 SELECT * INTO v FROM vendas WHERE id=p_venda;
 IF c.id IS NULL OR v.id IS NULL OR auth.uid() IS NULL OR NOT(public.is_fin_admin() OR (public.has_role(auth.uid(),'closer') AND c.closer_id=public.current_member_id())) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 IF c.closer_id IS DISTINCT FROM v.closer_id OR c.sdr_id IS DISTINCT FROM v.sdr_id OR (c.venda_id IS NOT NULL AND c.venda_id<>p_venda) THEN RAISE EXCEPTION 'A call deve ter o mesmo closer e SDR da venda e não estar ligada a outra venda'; END IF;
 UPDATE calls SET venda_id=p_venda WHERE id=p_call;
END $function$
;

CREATE OR REPLACE FUNCTION public.call_marcar(p_nome text, p_tel text, p_email text, p_agendada timestamp with time zone, p_closer uuid, p_sdr uuid, p_origem text DEFAULT 'EDA'::text, p_lead uuid DEFAULT NULL::uuid, p_nota text DEFAULT NULL::text, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_sdr uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_fin_admin() OR public.has_role(auth.uid(),'sdr')) THEN RAISE EXCEPTION 'Sem permissão para marcar calls'; END IF;
 v_sdr:=CASE WHEN public.is_fin_admin() THEN p_sdr ELSE public.current_member_id() END;
 IF NOT public.is_fin_admin() AND p_sdr IS DISTINCT FROM v_sdr THEN RAISE EXCEPTION 'Só podes marcar calls como a própria SDR'; END IF;
 IF nullif(trim(p_nome),'') IS NULL OR (nullif(trim(p_tel),'') IS NULL AND nullif(trim(p_email),'') IS NULL) OR p_agendada IS NULL OR p_closer IS NULL OR v_sdr IS NULL THEN RAISE EXCEPTION 'Lead, contacto, SDR, closer e data/hora obrigatórios'; END IF;
 IF p_origem NOT IN ('Pablo','Leandro','EDA','outro') THEN RAISE EXCEPTION 'Origem inválida'; END IF;
 IF p_lead IS NOT NULL THEN
 PERFORM 1 FROM public.leads_consolidados WHERE id=p_lead FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead indisponível'; END IF;
 END IF;
 IF NOT p_confirmar AND EXISTS(SELECT 1 FROM public.calls WHERE NOT legado AND estado='agendada' AND agendada_para>now() AND ((p_lead IS NOT NULL AND lead_id=p_lead) OR (nullif(trim(p_tel),'') IS NOT NULL AND public.normalize_tel(tel)=public.normalize_tel(p_tel)) OR (nullif(trim(p_email),'') IS NOT NULL AND lower(email)=lower(trim(p_email))))) THEN RETURN jsonb_build_object('aviso','Este lead já tem uma call ativa futura. Queres marcar outra?'); END IF;
 INSERT INTO public.calls(lead_id,nome_lead,tel,email,agendada_para,closer_id,sdr_id,origem,notas,created_by) VALUES(p_lead,trim(p_nome),nullif(trim(p_tel),''),nullif(trim(p_email),''),p_agendada,p_closer,v_sdr,p_origem,p_nota,auth.uid()) RETURNING id INTO v_id;
 IF p_lead IS NOT NULL THEN UPDATE public.leads_consolidados SET call_status='call_marcada',call_at=p_agendada,sdr_member_id=v_sdr,responsavel_member_id=p_closer,updated_by=auth.uid() WHERE id=p_lead; END IF;
 RETURN jsonb_build_object('id',v_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.call_validar(p_call uuid, p_estado text, p_nova_data timestamp with time zone DEFAULT NULL::timestamp with time zone, p_nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c calls%ROWTYPE; next_id uuid;
BEGIN
 SELECT * INTO c FROM calls WHERE id=p_call FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Call não encontrada'; END IF;
 IF NOT public.is_fin_admin() AND NOT(public.has_role(auth.uid(),'closer') AND c.closer_id=public.current_member_id()) THEN RAISE EXCEPTION 'Sem permissão para validar esta call'; END IF;
 IF c.legado OR c.estado<>'agendada' OR c.agendada_para>now() THEN RAISE EXCEPTION 'Só calls agendadas já passadas podem ser validadas'; END IF;
 IF p_estado NOT IN ('realizada','nao_compareceu','reagendada','cancelada') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
 IF p_estado='reagendada' THEN
  IF p_nova_data IS NULL OR p_nova_data<=now() THEN RAISE EXCEPTION 'Escolhe uma data futura'; END IF;
  INSERT INTO calls(lead_id,sdr_id,closer_id,nome_lead,email,tel,agendada_para,origem,notas,created_by) VALUES(c.lead_id,c.sdr_id,c.closer_id,c.nome_lead,c.email,c.tel,p_nova_data,c.origem,p_nota,auth.uid()) RETURNING id INTO next_id;
 END IF;
 UPDATE calls SET estado=p_estado,validada_em=now(),validada_por=auth.uid(),call_seguinte_id=next_id,notas=coalesce(p_nota,notas) WHERE id=p_call;
 RETURN next_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_analise(p_from date, p_to date, p_base text DEFAULT 'realizacao'::text, p_sdr uuid DEFAULT NULL::uuid, p_closer uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; ms date:=date_trunc('month',p_to)::date;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
 SELECT jsonb_build_object('membros',coalesce((SELECT jsonb_agg(jsonb_build_object('member_id',m.id,'nome',m.nome,'papel',m.role,'resumo',to_jsonb(r))) FROM members m CROSS JOIN LATERAL calls_resumo_total(p_from,p_to,CASE WHEN m.role='sdr' THEN m.id ELSE p_sdr END,CASE WHEN m.role='closer' THEN m.id ELSE p_closer END,p_base) r WHERE m.ativo AND m.role IN ('sdr','closer') AND (is_fin_admin() OR m.id=current_member_id()) AND (p_sdr IS NULL OR m.id=p_sdr) AND (p_closer IS NULL OR m.id=p_closer)),'[]'::jsonb),
 'dias',coalesce((SELECT jsonb_agg(jsonb_build_object('member_id',m.id,'dia',d::date,'resumo',to_jsonb(r))) FROM members m CROSS JOIN generate_series(p_from,p_to,interval '1 day') d CROSS JOIN LATERAL calls_resumo_total(d::date,d::date,m.id,NULL,p_base) r WHERE m.ativo AND m.role='sdr' AND extract(isodow FROM d)<=5 AND (is_fin_admin() OR m.id=current_member_id()) AND (p_sdr IS NULL OR m.id=p_sdr)),'[]'::jsonb),
 'perfis',(SELECT jsonb_agg(jsonb_build_object('origem',o,'resumo',to_jsonb(r))) FROM unnest(ARRAY['Pablo','Leandro','EDA','outro']) o CROSS JOIN LATERAL calls_resumo(p_from,p_to,p_sdr,p_closer,p_base,o) r),
 'bonus',coalesce((SELECT jsonb_agg(jsonb_build_object('member_id',m.id,'semana',w::date,'realizadas',r.realizadas,'bonus',CASE WHEN r.realizadas>=25 THEN 80 WHEN r.realizadas>=20 THEN 50 ELSE 0 END,'faltam_20',greatest(20-r.realizadas,0),'faltam_25',greatest(25-r.realizadas,0),'mensal_realizadas',mr.realizadas,'mensal_bonus',CASE WHEN mr.realizadas>=70 THEN 60 ELSE 0 END,'mensal_faltam',greatest(70-mr.realizadas,0),'mes',ms)) FROM members m CROSS JOIN generate_series(date_trunc('week',p_from)::date,date_trunc('week',p_to)::date,interval '1 week') w CROSS JOIN LATERAL calls_resumo(w::date,w::date+6,m.id,NULL,'realizacao') r CROSS JOIN LATERAL calls_resumo(ms,(ms+interval '1 month - 1 day')::date,m.id,NULL,'realizacao') mr WHERE m.ativo AND m.role='sdr' AND (is_fin_admin() OR m.id=current_member_id()) AND (p_sdr IS NULL OR m.id=p_sdr)),'[]'::jsonb)) INTO result;
 RETURN result || jsonb_build_object('extremos',coalesce((SELECT jsonb_agg(jsonb_build_object('member_id',m.id,
  'melhor_marcadas',(SELECT extract(isodow FROM d::date)::int FROM generate_series(p_from,p_to,interval '1 day') d CROSS JOIN LATERAL calls_resumo_total(d::date,d::date,m.id,NULL,p_base) r WHERE extract(isodow FROM d)<=5 GROUP BY 1 ORDER BY sum(r.marcadas) DESC,1 LIMIT 1),
  'pior_marcadas',(SELECT extract(isodow FROM d::date)::int FROM generate_series(p_from,p_to,interval '1 day') d CROSS JOIN LATERAL calls_resumo_total(d::date,d::date,m.id,NULL,p_base) r WHERE extract(isodow FROM d)<=5 GROUP BY 1 ORDER BY sum(r.marcadas),1 LIMIT 1),
  'melhor_realizadas',(SELECT extract(isodow FROM d::date)::int FROM generate_series(p_from,p_to,interval '1 day') d CROSS JOIN LATERAL calls_resumo_total(d::date,d::date,m.id,NULL,p_base) r WHERE extract(isodow FROM d)<=5 GROUP BY 1 ORDER BY sum(r.realizadas) DESC,1 LIMIT 1),
  'pior_realizadas',(SELECT extract(isodow FROM d::date)::int FROM generate_series(p_from,p_to,interval '1 day') d CROSS JOIN LATERAL calls_resumo_total(d::date,d::date,m.id,NULL,p_base) r WHERE extract(isodow FROM d)<=5 GROUP BY 1 ORDER BY sum(r.realizadas),1 LIMIT 1)))
  FROM members m WHERE m.ativo AND m.role='sdr' AND (is_fin_admin() OR m.id=current_member_id()) AND (p_sdr IS NULL OR m.id=p_sdr)),'[]'::jsonb));
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_daily(p_from date, p_to date, p_sdr uuid DEFAULT NULL::uuid, p_closer uuid DEFAULT NULL::uuid)
 RETURNS TABLE(dia date, resumo jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT d::date,to_jsonb(r) FROM generate_series(p_from,p_to,interval '1 day') d CROSS JOIN LATERAL calls_resumo_total(d::date,d::date,p_sdr,p_closer,'realizacao') r ORDER BY d $function$
;

CREATE OR REPLACE FUNCTION public.calls_daily_activity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF TG_TABLE_NAME='sdr_daily' THEN
  IF TG_OP='INSERT' AND (NEW.calls_marcadas<>0 OR NEW.calls_realizadas<>0 OR NEW.agendamentos_pablo<>0 OR NEW.agendamentos_leandro<>0) THEN RAISE EXCEPTION 'Calls só podem ser registadas individualmente'; END IF;
  IF TG_OP='UPDATE' AND (NEW.calls_marcadas IS DISTINCT FROM OLD.calls_marcadas OR NEW.calls_realizadas IS DISTINCT FROM OLD.calls_realizadas OR NEW.agendamentos_pablo IS DISTINCT FROM OLD.agendamentos_pablo OR NEW.agendamentos_leandro IS DISTINCT FROM OLD.agendamentos_leandro) THEN RAISE EXCEPTION 'Totais antigos de calls são apenas históricos'; END IF;
 ELSE
  IF TG_OP='INSERT' AND (NEW.calls_recebidas<>0 OR NEW.calls_realizadas<>0 OR NEW.calls_noshow<>0 OR NEW.calls_remarcadas<>0) THEN RAISE EXCEPTION 'Calls só podem ser registadas individualmente'; END IF;
  IF TG_OP='UPDATE' AND (NEW.calls_recebidas IS DISTINCT FROM OLD.calls_recebidas OR NEW.calls_realizadas IS DISTINCT FROM OLD.calls_realizadas OR NEW.calls_noshow IS DISTINCT FROM OLD.calls_noshow OR NEW.calls_remarcadas IS DISTINCT FROM OLD.calls_remarcadas) THEN RAISE EXCEPTION 'Totais antigos de calls são apenas históricos'; END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Calls não podem ser apagadas'; END IF;
 IF TG_OP='UPDATE' AND current_user NOT IN ('postgres','supabase_admin') AND NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Use call_validar'; END IF;
 IF NOT NEW.legado THEN
  IF NEW.agendada_para IS NULL OR NEW.closer_id IS NULL OR NEW.sdr_id IS NULL OR length(trim(NEW.nome_lead))=0 OR (nullif(trim(NEW.tel),'') IS NULL AND nullif(trim(NEW.email),'') IS NULL) THEN RAISE EXCEPTION 'Lead, contacto, SDR, closer e data/hora obrigatórios'; END IF;
  IF NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.closer_id AND ativo) OR NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.sdr_id AND ativo) THEN RAISE EXCEPTION 'Membro inativo'; END IF;
  NEW.data:=(NEW.agendada_para AT TIME ZONE 'Europe/Lisbon')::date;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_historico(p_from date, p_to date, p_sdr uuid DEFAULT NULL::uuid, p_closer uuid DEFAULT NULL::uuid)
 RETURNS TABLE(marcadas bigint, realizadas bigint, nao_compareceu bigint, reagendadas bigint, conversas bigint, respostas bigint, ligacoes bigint, followups bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t date := least(p_to, date '2026-10-14'); me uuid := public.current_member_id(); adm boolean := public.is_fin_admin();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
 IF p_from > t THEN RETURN QUERY SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint; RETURN; END IF;
 IF p_sdr IS NOT NULL THEN
  RETURN QUERY SELECT coalesce(sum(s.calls_marcadas),0)::bigint, coalesce(sum(s.calls_realizadas),0)::bigint, 0::bigint, 0::bigint,
   coalesce(sum(s.conversas_iniciadas),0)::bigint, coalesce(sum(s.respostas_1a),0)::bigint, coalesce(sum(s.ligacoes_feitas),0)::bigint, coalesce(sum(s.followups_feitos),0)::bigint
   FROM public.sdr_daily s WHERE s.data BETWEEN p_from AND t AND s.member_id = p_sdr AND (adm OR s.member_id = me);
 ELSE
  RETURN QUERY SELECT coalesce(sum(c.calls_recebidas),0)::bigint, coalesce(sum(c.calls_realizadas),0)::bigint, coalesce(sum(c.calls_noshow),0)::bigint, coalesce(sum(c.calls_remarcadas),0)::bigint,
   (SELECT coalesce(sum(s.conversas_iniciadas),0) FROM public.sdr_daily s WHERE s.data BETWEEN p_from AND t AND (adm OR s.member_id=me))::bigint,
   (SELECT coalesce(sum(s.respostas_1a),0) FROM public.sdr_daily s WHERE s.data BETWEEN p_from AND t AND (adm OR s.member_id=me))::bigint,
   (SELECT coalesce(sum(s.ligacoes_feitas),0) FROM public.sdr_daily s WHERE s.data BETWEEN p_from AND t AND (adm OR s.member_id=me))::bigint,
   (SELECT coalesce(sum(s.followups_feitos),0) FROM public.sdr_daily s WHERE s.data BETWEEN p_from AND t AND (adm OR s.member_id=me))::bigint
   FROM public.closer_daily c WHERE c.data BETWEEN p_from AND t AND (p_closer IS NULL OR c.member_id = p_closer) AND (adm OR c.member_id = me);
 END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE changed text[];
BEGIN
 SELECT array_agg(key) INTO changed FROM jsonb_each(to_jsonb(NEW)) WHERE TG_OP='INSERT' OR value IS DISTINCT FROM to_jsonb(OLD)->key;
 INSERT INTO calls_hist(call_id,actor_id,acao,campos,antes,depois) VALUES(NEW.id,auth.uid(),TG_OP,changed,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_link_sale_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c calls%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.call_id IS NOT DISTINCT FROM OLD.call_id THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.call_id IS NOT NULL THEN RAISE EXCEPTION 'A ligação existente deve ser preservada'; END IF;
 IF NEW.call_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM calls WHERE id=NEW.call_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT(is_fin_admin() OR (has_role(auth.uid(),'closer') AND c.closer_id=current_member_id())) OR c.closer_id IS DISTINCT FROM NEW.closer_id OR c.sdr_id IS DISTINCT FROM NEW.sdr_id OR c.legado OR c.venda_id IS NOT NULL THEN RAISE EXCEPTION 'A call deve pertencer ao mesmo closer e SDR e estar disponível'; END IF;
 UPDATE calls SET venda_id=NEW.id WHERE id=c.id;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_lista(p_por_validar boolean DEFAULT false)
 RETURNS TABLE(id uuid, nome_lead text, tel text, email text, sdr_id uuid, closer_id uuid, lead_id uuid, agendada_para timestamp with time zone, origem text, estado text, validada_em timestamp with time zone, call_seguinte_id uuid, venda_id uuid, notas text, created_at timestamp with time zone, atrasada boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT c.id,c.nome_lead,c.tel,c.email,c.sdr_id,c.closer_id,c.lead_id,c.agendada_para,c.origem,c.estado,c.validada_em,c.call_seguinte_id,c.venda_id,c.notas,c.created_at,c.estado='agendada' AND c.agendada_para<now()-interval '24 hours' FROM calls c WHERE NOT c.legado AND (NOT p_por_validar OR (c.estado='agendada' AND c.agendada_para<=now())) ORDER BY c.agendada_para ASC
$function$
;

CREATE OR REPLACE FUNCTION public.calls_periods(p_from date, p_to date, p_sdr uuid DEFAULT NULL::uuid, p_closer uuid DEFAULT NULL::uuid)
 RETURNS TABLE(inicio date, fim date, resumo jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT d::date,least(d::date+6,p_to),to_jsonb(r) FROM generate_series(p_from,p_to,interval '1 week') d CROSS JOIN LATERAL calls_resumo_total(d::date,least(d::date+6,p_to),p_sdr,p_closer,'realizacao') r $function$
;

CREATE OR REPLACE FUNCTION public.calls_resumo(p_from date, p_to date, p_sdr uuid DEFAULT NULL::uuid, p_closer uuid DEFAULT NULL::uuid, p_base text DEFAULT 'realizacao'::text, p_origem text DEFAULT NULL::text)
 RETURNS TABLE(marcadas bigint, realizadas bigint, nao_compareceu bigint, reagendadas bigint, canceladas bigint, por_validar bigint, atrasadas bigint, taxa_comparencia numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
 IF p_base NOT IN ('marcacao','realizacao','marcação','realização') OR p_from>p_to THEN RAISE EXCEPTION 'Intervalo ou base inválidos'; END IF;
 RETURN QUERY WITH visible AS (
 SELECT c.* FROM calls c WHERE NOT c.legado AND (public.is_fin_admin() OR (public.has_role(auth.uid(),'sdr') AND c.sdr_id=public.current_member_id()) OR (public.has_role(auth.uid(),'closer') AND c.closer_id=public.current_member_id()))
 AND (p_sdr IS NULL OR c.sdr_id=p_sdr) AND (p_closer IS NULL OR c.closer_id=p_closer) AND (p_origem IS NULL OR c.origem=p_origem)
 AND (CASE WHEN p_base IN ('marcacao','marcação') THEN (c.created_at AT TIME ZONE 'Europe/Lisbon')::date ELSE (c.agendada_para AT TIME ZONE 'Europe/Lisbon')::date END) BETWEEN p_from AND p_to
 ), counts AS (SELECT count(*) m,count(*) FILTER(WHERE estado='realizada' AND validada_em IS NOT NULL) r,count(*) FILTER(WHERE estado='nao_compareceu' AND validada_em IS NOT NULL) n,count(*) FILTER(WHERE estado='reagendada' AND validada_em IS NOT NULL) re,count(*) FILTER(WHERE estado='cancelada') ca,count(*) FILTER(WHERE estado='agendada' AND agendada_para<=now()) pv,count(*) FILTER(WHERE estado='agendada' AND agendada_para<now()-interval '24 hours') at FROM visible)
 SELECT m,r,n,re,ca,pv,at,coalesce(round(100.0*r/nullif(r+n,0),1),0) FROM counts;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_resumo_total(p_from date, p_to date, p_sdr uuid DEFAULT NULL::uuid, p_closer uuid DEFAULT NULL::uuid, p_base text DEFAULT 'realizacao'::text, p_origem text DEFAULT NULL::text)
 RETURNS TABLE(marcadas bigint, realizadas bigint, nao_compareceu bigint, reagendadas bigint, canceladas bigint, por_validar bigint, atrasadas bigint, taxa_comparencia numeric, hist_marcadas bigint, hist_realizadas bigint, hist_nao_compareceu bigint, hist_reagendadas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT r.marcadas,r.realizadas,r.nao_compareceu,r.reagendadas,r.canceladas,r.por_validar,r.atrasadas,r.taxa_comparencia,h.marcadas,h.realizadas,h.nao_compareceu,h.reagendadas
 FROM public.calls_resumo(p_from,p_to,p_sdr,p_closer,p_base,p_origem) r
 CROSS JOIN LATERAL (SELECT * FROM public.calls_historico(p_from,p_to,p_sdr,p_closer) WHERE p_origem IS NULL UNION ALL SELECT 0,0,0,0,0,0,0,0 WHERE p_origem IS NOT NULL) h
$function$
;

CREATE OR REPLACE FUNCTION public.calls_stamp_creator()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin') AND NOT is_fin_admin() THEN NEW.created_at:=now(); NEW.created_by:=auth.uid(); END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.calls_to_noshow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NEW.estado='nao_compareceu' AND NOT NEW.legado AND (TG_OP='INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado) THEN
  INSERT INTO public.noshows(nome,email,tel,sdr_id,closer_id,data,produto,ticket,motivo,obs,status,source_call_id)
  VALUES(NEW.nome_lead,NEW.email,NEW.tel,NEW.sdr_id,NEW.closer_id,NEW.data,NEW.produto,NEW.valor_oferecido,'Não compareceu à call validada',NEW.notas,'nao_contatado',NEW.id)
  ON CONFLICT(source_call_id) WHERE source_call_id IS NOT NULL DO NOTHING;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.central_apagar_lead(p_lead uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.is_fin_admin() THEN RAISE EXCEPTION 'Só a gerência pode apagar leads'; END IF;
 DELETE FROM public.leads_consolidados WHERE id=p_lead;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead indisponível'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.cobrancas_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.vencimento_original IS NULL THEN NEW.vencimento_original := NEW.data; END IF;
  IF TG_OP = 'INSERT' AND NEW.pago AND NEW.estado = 'pendente' THEN
    NEW.estado := 'pago';
    NEW.pago_em := COALESCE(NEW.pago_em, NEW.data);
    NEW.valor_recebido := COALESCE(NEW.valor_recebido, NEW.valor);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.convert_sinal_to_venda(p_id uuid, p_forma_pagamento text DEFAULT NULL::text, p_parcelas integer DEFAULT 1, p_pago numeric DEFAULT 0)
 RETURNS vendas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.vendas;
  v_closer public.members;
  v_sdr public.members;
  v_new_ticket numeric;
  v_parcelas int;
  v_valor_parcela numeric;
  v_com_closer numeric := 0;
  v_com_sdr numeric := 0;
  i int;
BEGIN
  SELECT * INTO v FROM public.vendas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF NOT v.is_sinal THEN RAISE EXCEPTION 'Este registo não é um sinal'; END IF;

  IF NOT (public.has_role(auth.uid(),'socio')
    OR (public.has_role(auth.uid(),'closer') AND v.closer_id = public.current_member_id())) THEN
    RAISE EXCEPTION 'Sem permissão para converter este sinal';
  END IF;

  v_new_ticket := COALESCE(v.valor_total_previsto, v.ticket);
  v_parcelas := GREATEST(COALESCE(p_parcelas, 1), 1);
  v_valor_parcela := ROUND((v_new_ticket / v_parcelas)::numeric, 2);

  IF v.closer_id IS NOT NULL THEN
    SELECT * INTO v_closer FROM public.members WHERE id = v.closer_id;
    IF NOT v_closer.is_founder THEN
      v_com_closer := ROUND((v_new_ticket * 7 / 100)::numeric, 2);
    END IF;
  END IF;
  IF v.sdr_id IS NOT NULL THEN
    SELECT * INTO v_sdr FROM public.members WHERE id = v.sdr_id;
    IF NOT v_sdr.is_founder THEN
      v_com_sdr := ROUND((v_new_ticket * 3 / 100)::numeric, 2);
    END IF;
  END IF;

  UPDATE public.vendas SET
    is_sinal = false,
    ticket = v_new_ticket,
    parcelas = v_parcelas,
    valor_parcela = v_valor_parcela,
    forma_pagamento = COALESCE(p_forma_pagamento, v.forma_pagamento),
    pago = COALESCE(p_pago, v.pago),
    comissao_closer = v_com_closer,
    comissao_sdr = v_com_sdr,
    status = 'ativo'::public.venda_status
  WHERE id = p_id
  RETURNING * INTO v;

  DELETE FROM public.cobrancas WHERE venda_id = p_id;
  IF v_parcelas > 1 THEN
    FOR i IN 1..v_parcelas LOOP
      INSERT INTO public.cobrancas(venda_id, nome, tel, email, valor, parcela_num, total_parcelas, data, pago)
      VALUES (
        v.id, v.nome_cliente, v.tel, v.email, v_valor_parcela, i, v_parcelas,
        (v.data + ((i-1) || ' months')::interval)::date,
        CASE WHEN i = 1 AND v.pago >= v_valor_parcela THEN true ELSE false END
      );
    END LOOP;
  END IF;

  RETURN v;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm2_equipa()
 RETURNS TABLE(id uuid, nome text, role text, funcao text, foto_url text, is_socio boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, m.nome, m.role::text, m.funcao, m.foto_url,
    exists(select 1 from profiles p join user_roles ur on ur.user_id=p.id where p.member_id=m.id and ur.role='socio'::app_role)
  from members m where m.ativo and auth.uid() is not null order by m.nome
$function$
;

CREATE OR REPLACE FUNCTION public.crm2_lc_sync_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.etapa is null then new.etapa := new.status::text; end if;
  elsif new.status is distinct from old.status and new.etapa is not distinct from old.etapa then
    new.etapa := new.status::text;
  end if;
  if new.status = 'fechado' then new.etapa := 'fechado'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm2_metas_realizado(p_from date, p_to date)
 RETURNS TABLE(bruto numeric, liquido numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT bruto,liquido FROM public.fin_resumo_mes(p_from,p_to) $function$
;

CREATE OR REPLACE FUNCTION public.crm2_placar(p_from date, p_to date)
 RETURNS TABLE(bruto numeric, vendas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(ticket),0), count(*) from vendas
  where auth.uid() is not null and status in ('ativo','quitada') and not coalesce(is_sinal,false) and data between p_from and p_to
    and lower(trim(coalesce(produto,''))) <> 'pve'
$function$
;

CREATE OR REPLACE FUNCTION public.crm2_ranking(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, nome text, role text, funcao text, foto_url text, vendas bigint, vendido numeric, closer_calls bigint, sdr_calls_realizadas bigint, sdr_calls_marcadas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, m.nome, m.role::text, m.funcao, m.foto_url,
    (select count(*) from vendas v where v.closer_id=m.id and v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and v.data between p_from and p_to),
    (select coalesce(sum(v.ticket),0) from vendas v where v.closer_id=m.id and v.status in ('ativo','quitada') and not coalesce(v.is_sinal,false) and v.data between p_from and p_to),
    (select coalesce(sum(c.calls_realizadas),0) from closer_daily c where c.member_id=m.id and c.data between p_from and p_to),
    (select coalesce(sum(s.calls_realizadas),0) from sdr_daily s where s.member_id=m.id and s.data between p_from and p_to),
    (select coalesce(sum(s.calls_marcadas),0) from sdr_daily s where s.member_id=m.id and s.data between p_from and p_to)
  from members m where m.ativo and auth.uid() is not null
$function$
;

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

CREATE OR REPLACE FUNCTION public.vendas_pve_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ BEGIN
 IF NEW.produto='PVE' AND (NEW.forma_pagamento NOT IN ('À vista','Cartão - à vista','Klarna') OR NEW.parcelas<>1) THEN RAISE EXCEPTION 'PVE só permite pagamento à vista ou Klarna, numa parcela'; END IF;
 RETURN NEW;
END $function$
;
