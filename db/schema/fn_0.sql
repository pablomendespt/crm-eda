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

