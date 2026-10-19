-- Ranking do mês (Equipa > Recordes): closers por faturação, SDRs por vendas geradas.
-- Só leitura. Não expõe comissões. Mesma regra de venda válida dos recordes:
-- status ativo/quitada e sem sinais.
create or replace function public.crm2_ranking_mes(p_from date, p_to date)
returns table(
  member_id uuid, nome text, role text, foto_url text,
  closer_vendas bigint, closer_valor numeric, closer_calls bigint,
  sdr_vendas bigint, sdr_marcadas bigint, sdr_realizadas bigint
)
language sql stable security definer
set search_path to 'public'
as $$
  select m.id, m.nome, m.role::text, m.foto_url,
    (select count(*) from vendas v where v.closer_id = m.id and v.status in ('ativo','quitada')
       and not coalesce(v.is_sinal,false) and v.data between p_from and p_to),
    (select coalesce(sum(v.ticket),0) from vendas v where v.closer_id = m.id and v.status in ('ativo','quitada')
       and not coalesce(v.is_sinal,false) and v.data between p_from and p_to),
    (select coalesce(sum(c.calls_realizadas),0) from closer_daily c where c.member_id = m.id
       and c.data between p_from and p_to),
    (select count(*) from vendas v where v.sdr_id = m.id and v.status in ('ativo','quitada')
       and not coalesce(v.is_sinal,false) and v.data between p_from and p_to),
    (select coalesce(sum(s.calls_marcadas),0) from sdr_daily s where s.member_id = m.id
       and s.data between p_from and p_to),
    (select coalesce(sum(s.calls_realizadas),0) from sdr_daily s where s.member_id = m.id
       and s.data between p_from and p_to)
  from members m
  where m.ativo and m.role::text in ('closer','sdr') and auth.uid() is not null
$$;

revoke all on function public.crm2_ranking_mes(date, date) from public, anon;
grant execute on function public.crm2_ranking_mes(date, date) to authenticated;
