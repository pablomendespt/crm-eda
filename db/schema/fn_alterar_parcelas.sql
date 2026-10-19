-- Alterar o número de parcelas de uma venda recorrente (só gerência).
-- Mantém as parcelas já pagas, remove ou acrescenta parcelas pendentes (mês a mês)
-- e redistribui o que falta pagar. Comissões já geradas não mudam.
create or replace function public.fin_alterar_parcelas(p_venda uuid, p_n integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.vendas; last_c public.cobrancas;
  np int; ncur int; pend int; k int; mx int; d date;
  pago_tot numeric; resto numeric; cada numeric; ult numeric;
begin
  if not public.is_fin_admin() then raise exception 'Sem permissão'; end if;
  if p_n is null or p_n < 1 or p_n > 24 then raise exception 'Número de parcelas inválido (use de 1 a 24)'; end if;
  select * into v from public.vendas where id = p_venda for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if coalesce(v.is_sinal,false) or v.status not in ('ativo','quitada') then
    raise exception 'Esta venda não permite alterar o número de parcelas';
  end if;
  select count(*), coalesce(sum(coalesce(valor_recebido, valor)),0) into np, pago_tot
    from public.cobrancas where venda_id = p_venda and estado = 'pago';
  select count(*) into ncur from public.cobrancas where venda_id = p_venda and estado in ('pago','pendente');
  if ncur = 0 then raise exception 'Esta venda não tem parcelas'; end if;
  if p_n < np then raise exception 'Já existem % parcelas pagas: o número não pode ser menor', np; end if;
  if p_n = ncur then return; end if;
  resto := v.ticket - pago_tot;
  if resto < 0 then raise exception 'O já recebido é maior que o valor da venda'; end if;

  if p_n < ncur then
    delete from public.cobrancas where id in (
      select id from public.cobrancas where venda_id = p_venda and estado = 'pendente'
      order by parcela_num desc limit (ncur - p_n));
  else
    select * into last_c from public.cobrancas
      where venda_id = p_venda and estado in ('pago','pendente') order by parcela_num desc limit 1;
    mx := last_c.parcela_num; d := last_c.data;
    for k in 1..(p_n - ncur) loop
      d := (d + interval '1 month')::date;
      insert into public.cobrancas(venda_id, nome, tel, email, valor, parcela_num, total_parcelas, data, estado, pago)
      values (p_venda, last_c.nome, last_c.tel, last_c.email, 0, mx + k, p_n, d, 'pendente', false);
    end loop;
  end if;

  update public.cobrancas set total_parcelas = p_n where venda_id = p_venda and estado in ('pago','pendente');
  select count(*) into pend from public.cobrancas where venda_id = p_venda and estado = 'pendente';
  if pend > 0 then
    cada := round(resto / pend, 2);
    ult := round(resto - cada * (pend - 1), 2);
    update public.cobrancas set valor = cada where venda_id = p_venda and estado = 'pendente';
    update public.cobrancas set valor = ult where id = (
      select id from public.cobrancas where venda_id = p_venda and estado = 'pendente' order by parcela_num desc limit 1);
  end if;
  update public.vendas set parcelas = p_n, valor_parcela = round(ticket / p_n, 2),
    status = case when pend = 0 and status = 'ativo' then 'quitada' when pend > 0 and status = 'quitada' then 'ativo' else status end
    where id = p_venda;
  insert into public.fin_hist(venda_id, acao, de, para, valor, actor_id, actor_nome)
  values (p_venda, 'parcelas', ncur::text, p_n::text, v.ticket, auth.uid(), public.current_member_nome());
end $function$;

revoke all on function public.fin_alterar_parcelas(uuid, integer) from public, anon;
grant execute on function public.fin_alterar_parcelas(uuid, integer) to authenticated;
