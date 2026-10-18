-- Rode este arquivo inteiro no SQL Editor do Supabase (projeto crm-eda).
-- Cria as 6 funcoes que contem comandos de apagar, que eu nao posso aplicar por la.
SET check_function_bodies = off;

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

-- Triggers que dependem das funcoes acima
CREATE TRIGGER audit_leads AFTER INSERT OR DELETE OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION tg_audit_log();
CREATE TRIGGER central_delete_audit AFTER DELETE ON public.leads_consolidados FOR EACH ROW EXECUTE FUNCTION tg_audit_log();
CREATE TRIGGER trg_metas_itens_hist AFTER INSERT OR DELETE OR UPDATE ON public.metas_itens FOR EACH ROW EXECUTE FUNCTION tg_metas_itens_hist();
CREATE TRIGGER audit_noshows AFTER INSERT OR DELETE OR UPDATE ON public.noshows FOR EACH ROW EXECUTE FUNCTION tg_audit_log();
CREATE TRIGGER audit_vendas AFTER INSERT OR DELETE OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION tg_audit_log();
CREATE TRIGGER trg_venda_to_registo_hist AFTER INSERT OR UPDATE ON public.vendas FOR EACH ROW EXECUTE FUNCTION tg_venda_to_registo_hist();
CREATE TRIGGER trg_vendas_sinal_hist_del AFTER DELETE ON public.vendas FOR EACH ROW WHEN ((old.is_sinal IS TRUE)) EXECUTE FUNCTION tg_vendas_sinal_hist();
CREATE TRIGGER trg_vendas_sinal_hist_upd AFTER UPDATE OF is_sinal ON public.vendas FOR EACH ROW WHEN (((old.is_sinal IS TRUE) AND (new.is_sinal IS FALSE))) EXECUTE FUNCTION tg_vendas_sinal_hist();

-- Permissoes das funcoes de apagar/converter (so para usuarios logados)
REVOKE ALL ON FUNCTION public.central_apagar_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.central_apagar_lead(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.convert_sinal_to_venda(uuid, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_sinal_to_venda(uuid, text, integer, numeric) TO authenticated, service_role;

-- Conferencia (deve mostrar funcoes = 108 e triggers = 51)
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f') as funcoes,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) as triggers;
