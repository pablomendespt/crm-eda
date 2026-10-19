-- Funil: funções (regras no servidor). Todas SECURITY DEFINER, chamadas só por utilizadores autenticados.
set local search_path = public, extensions;

create or replace function public._funil_log(p_card public.funil_cards, p_tipo text, p_de text, p_para text, p_dados jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.funil_eventos(card_id, card_nome, member_id, tipo, de, para, dados)
  values (p_card.id, p_card.nome, public.current_member_id(), p_tipo, p_de, p_para, coalesce(p_dados,'{}'::jsonb));
$$;
revoke all on function public._funil_log(public.funil_cards, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public._funil_card(p_id uuid) returns public.funil_cards
language plpgsql security definer set search_path = public as $$
declare c public.funil_cards;
begin
  select * into c from public.funil_cards where id = p_id for update;
  if not found then raise exception 'Cartão não encontrado'; end if;
  return c;
end $$;
revoke all on function public._funil_card(uuid) from public, anon, authenticated;

-- Criar lead
create or replace function public.funil_criar(p_nome text, p_tel text default null, p_email text default null,
  p_ig text default null, p_origem text default 'Outro', p_localidade text default null, p_notas text default null)
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards; papel text := public.funil_papel();
begin
  if papel not in ('socio','sdr','closer') then raise exception 'Sem permissão para criar leads'; end if;
  insert into public.funil_cards(nome, tel, email, ig, origem, localidade, notas, sdr_id)
  values (btrim(p_nome), nullif(btrim(p_tel),''), nullif(btrim(p_email),''), nullif(btrim(p_ig),''),
          coalesce(nullif(btrim(p_origem),''),'Outro'), nullif(btrim(p_localidade),''), nullif(btrim(p_notas),''),
          case when papel = 'sdr' then public.current_member_id() else null end)
  returning * into c;
  perform public._funil_log(c, 'criado', null, 'novo');
  return c;
end $$;

-- Editar dados do cartão (só campos de ficha)
create or replace function public.funil_atualizar(p_id uuid, p_dados jsonb)
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards;
begin
  if public.funil_papel() is null then raise exception 'Sem permissão'; end if;
  c := public._funil_card(p_id);
  update public.funil_cards set
    nome = coalesce(nullif(btrim(p_dados->>'nome'),''), nome),
    tel = case when p_dados ? 'tel' then nullif(btrim(p_dados->>'tel'),'') else tel end,
    email = case when p_dados ? 'email' then nullif(btrim(p_dados->>'email'),'') else email end,
    ig = case when p_dados ? 'ig' then nullif(btrim(p_dados->>'ig'),'') else ig end,
    origem = coalesce(nullif(btrim(p_dados->>'origem'),''), origem),
    localidade = case when p_dados ? 'localidade' then nullif(btrim(p_dados->>'localidade'),'') else localidade end,
    perfil = case when p_dados ? 'perfil' then nullif(btrim(p_dados->>'perfil'),'') else perfil end,
    notas = case when p_dados ? 'notas' then nullif(btrim(p_dados->>'notas'),'') else notas end,
    temperatura = case when p_dados ? 'temperatura' then nullif(p_dados->>'temperatura','') else temperatura end,
    objecao = case when p_dados ? 'objecao' then nullif(btrim(p_dados->>'objecao'),'') else objecao end,
    proxima_em = case when p_dados ? 'proxima_em' then nullif(p_dados->>'proxima_em','')::date else proxima_em end
  where id = p_id returning * into c;
  return c;
end $$;

-- Registar uma ligação ou mensagem (conta nas métricas de quem fez). Novo Lead passa a Em conversa.
create or replace function public.funil_registar_contacto(p_id uuid, p_tipo text)
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards; antes text;
begin
  if public.funil_papel() not in ('socio','sdr','closer') then raise exception 'Sem permissão'; end if;
  if p_tipo not in ('ligacao','mensagem') then raise exception 'Tipo inválido'; end if;
  c := public._funil_card(p_id);
  if c.saida is not null then raise exception 'Este lead já saiu do funil'; end if;
  antes := c.etapa;
  update public.funil_cards set
    ligacoes = ligacoes + (p_tipo = 'ligacao')::int,
    mensagens = mensagens + (p_tipo = 'mensagem')::int,
    ultimo_contacto_em = now(),
    sdr_id = coalesce(sdr_id, case when public.funil_papel() = 'sdr' then public.current_member_id() end),
    etapa = case when etapa = 'novo' then 'conversa' else etapa end,
    etapa_em = case when etapa = 'novo' then now() else etapa_em end
  where id = p_id returning * into c;
  perform public._funil_log(c, p_tipo, antes, c.etapa);
  if antes = 'novo' then perform public._funil_log(c, 'mover', 'novo', 'conversa'); end if;
  return c;
end $$;

-- Mover entre etapas simples. Call/Sinal/Venda têm funções próprias (precisam de dados).
create or replace function public.funil_mover(p_id uuid, p_etapa text, p_proxima date default null)
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards; papel text := public.funil_papel(); de text;
begin
  if papel is null then raise exception 'Sem permissão'; end if;
  if p_etapa in ('call','sinal','venda') then
    raise exception 'Esta etapa pede dados (agenda, sinal ou venda).';
  end if;
  if p_etapa not in ('novo','conversa','qualificado','realizada','noshow','followup','onboarding','aluno') then
    raise exception 'Etapa inválida';
  end if;
  c := public._funil_card(p_id);
  if c.saida is not null then raise exception 'Este lead já saiu do funil. Reativa primeiro.'; end if;
  de := c.etapa;
  if de = p_etapa then return c; end if;

  if p_etapa in ('novo','conversa','qualificado','followup') and papel not in ('socio','sdr','closer') then
    raise exception 'Sem permissão para esta etapa';
  end if;
  if p_etapa in ('realizada','noshow') and papel not in ('socio','closer') then
    raise exception 'Só o closer confirma se a call aconteceu';
  end if;
  if p_etapa in ('onboarding','aluno') then
    if papel not in ('socio','cs') then raise exception 'Onboarding e Alunos são do Customer Success'; end if;
    if p_etapa = 'onboarding' and de <> 'venda' and papel <> 'socio' then
      raise exception 'Só entra em onboarding depois da venda paga';
    end if;
    if p_etapa = 'aluno' and de not in ('onboarding','venda') and papel <> 'socio' then
      raise exception 'Primeiro passa por onboarding';
    end if;
  end if;

  if p_etapa = 'realizada' then
    update public.funil_agenda set estado = 'realizada' where card_id = p_id and estado = 'marcada';
    if c.closer_id is null and papel = 'closer' then c.closer_id := public.current_member_id(); end if;
  elsif p_etapa = 'noshow' then
    update public.funil_agenda set estado = 'noshow' where card_id = p_id and estado = 'marcada';
  end if;

  update public.funil_cards set
    etapa = p_etapa, etapa_em = now(),
    closer_id = c.closer_id,
    proxima_em = case when p_etapa = 'followup' then coalesce(p_proxima, current_date + 3) else proxima_em end,
    onboarding_em = case when p_etapa = 'onboarding' then now() else onboarding_em end,
    aluno_desde = case when p_etapa = 'aluno' then current_date else aluno_desde end
  where id = p_id returning * into c;
  perform public._funil_log(c, 'mover', de, p_etapa);
  return c;
end $$;

-- Marcar (ou remarcar) call: grava na agenda e leva o cartão para Call Marcada.
create or replace function public.funil_marcar_call(p_id uuid, p_closer uuid, p_inicio timestamptz,
  p_fim timestamptz default null, p_link text default null)
returns public.funil_agenda language plpgsql security definer set search_path = public as $$
declare c public.funil_cards; a public.funil_agenda; de text; fim timestamptz; remarcou boolean := false;
begin
  if public.funil_papel() not in ('socio','sdr','closer') then raise exception 'Sem permissão'; end if;
  c := public._funil_card(p_id);
  if c.saida is not null then raise exception 'Este lead já saiu do funil'; end if;
  if not exists (select 1 from public.members where id = p_closer and ativo and role::text = 'closer') then
    raise exception 'Escolhe um closer ativo';
  end if;
  fim := coalesce(p_fim, p_inicio + interval '45 minutes');
  if p_inicio < now() - interval '1 hour' then raise exception 'A hora da call já passou'; end if;
  de := c.etapa;
  update public.funil_agenda set estado = 'remarcada' where card_id = p_id and estado = 'marcada';
  remarcou := found;
  begin
    insert into public.funil_agenda(card_id, closer_id, inicio, fim, link) values (p_id, p_closer, p_inicio, fim, nullif(btrim(p_link),''))
    returning * into a;
  exception when exclusion_violation then
    raise exception 'Esse closer já tem uma call nesse horário. Escolhe outra hora.';
  end;
  update public.funil_cards set etapa = 'call', etapa_em = now(), closer_id = p_closer,
    sdr_id = coalesce(sdr_id, case when public.funil_papel() = 'sdr' then public.current_member_id() end)
  where id = p_id returning * into c;
  perform public._funil_log(c, case when remarcou then 'remarcar' else 'mover' end, de, 'call',
    jsonb_build_object('inicio', p_inicio, 'closer_id', p_closer));
  if remarcou then perform public._funil_log(c, 'mover', de, 'call'); end if;
  return a;
end $$;

-- Sair do funil: perdido ou desqualificado (lista para Pablo e Leandro rever)
create or replace function public.funil_sair(p_id uuid, p_tipo text, p_motivo text default null)
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards;
begin
  if public.funil_papel() not in ('socio','sdr','closer') then raise exception 'Sem permissão'; end if;
  if p_tipo not in ('perdido','desqualificado') then raise exception 'Tipo inválido'; end if;
  c := public._funil_card(p_id);
  if c.etapa in ('sinal','venda','onboarding','aluno') then raise exception 'Quem já pagou não sai do funil por aqui'; end if;
  update public.funil_agenda set estado = 'cancelada' where card_id = p_id and estado = 'marcada';
  update public.funil_cards set saida = p_tipo, saida_motivo = nullif(btrim(p_motivo),''), saida_em = now()
  where id = p_id returning * into c;
  perform public._funil_log(c, 'saida', c.etapa, p_tipo, jsonb_build_object('motivo', p_motivo));
  return c;
end $$;

create or replace function public.funil_reativar(p_id uuid)
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards;
begin
  if public.funil_papel() not in ('socio','sdr','closer') then raise exception 'Sem permissão'; end if;
  c := public._funil_card(p_id);
  update public.funil_cards set saida = null, saida_motivo = null, saida_em = null, etapa_em = now()
  where id = p_id returning * into c;
  perform public._funil_log(c, 'reativar', null, c.etapa);
  return c;
end $$;

-- Sinal pago: cria o sinal em vendas (mesmo circuito do ecrã Sinais).
create or replace function public.funil_registar_sinal(p_id uuid, p_valor numeric, p_total numeric,
  p_prevista date default null, p_forma text default 'À vista')
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards; v public.vendas; papel text := public.funil_papel(); de text; cl uuid;
begin
  if papel not in ('socio','closer') then raise exception 'Só o closer regista sinal'; end if;
  if coalesce(p_valor,0) <= 0 or coalesce(p_total,0) < p_valor then raise exception 'Confere os valores do sinal e do total'; end if;
  c := public._funil_card(p_id);
  if c.saida is not null then raise exception 'Este lead já saiu do funil'; end if;
  if c.venda_id is not null then raise exception 'Este cartão já tem sinal ou venda'; end if;
  cl := coalesce(c.closer_id, case when papel = 'closer' then public.current_member_id() end);
  if cl is null then raise exception 'Define o closer antes (marca a call)'; end if;
  de := c.etapa;
  insert into public.vendas(data, nome_cliente, email, tel, closer_id, sdr_id, ticket, pago, forma_pagamento,
    parcelas, is_sinal, valor_total_previsto, data_prevista_fecho, produto, notas)
  values (current_date, c.nome, c.email, c.tel, cl, c.sdr_id, p_valor, p_valor, coalesce(p_forma,'À vista'),
    1, true, p_total, p_prevista, 'Europa Digital Academy', 'Via Funil')
  returning * into v;
  update public.funil_cards set etapa = 'sinal', etapa_em = now(), closer_id = cl, venda_id = v.id,
    sinal_valor = p_valor, pagamento = coalesce(p_forma,'À vista')
  where id = p_id returning * into c;
  perform public._funil_log(c, 'mover', de, 'sinal', jsonb_build_object('valor', p_valor, 'total', p_total));
  return c;
end $$;

-- Venda paga: converte o sinal (se houver) ou cria a venda. Comissões, cobranças e onboarding de CS disparam pelos triggers.
create or replace function public.funil_registar_venda(p_id uuid, p_ticket numeric, p_forma text,
  p_parcelas integer default 1, p_pago numeric default null, p_produto text default 'Europa Digital Academy')
returns public.funil_cards language plpgsql security definer set search_path = public as $$
declare c public.funil_cards; v public.vendas; papel text := public.funil_papel(); de text; cl uuid;
  parc int := greatest(coalesce(p_parcelas,1),1); pago numeric; vp numeric;
begin
  if papel not in ('socio','closer') then raise exception 'Só o closer regista venda'; end if;
  c := public._funil_card(p_id);
  if c.saida is not null then raise exception 'Este lead já saiu do funil'; end if;
  de := c.etapa;
  if c.venda_id is not null and exists (select 1 from public.vendas where id = c.venda_id and is_sinal) then
    select * into v from public.convert_sinal_to_venda(c.venda_id, p_forma, parc, coalesce(p_pago, 0));
  else
    if c.venda_id is not null then raise exception 'Este cartão já tem venda'; end if;
    if coalesce(p_ticket,0) <= 0 then raise exception 'Indica o valor da venda'; end if;
    if p_forma not in ('À vista','Cartão - à vista','Klarna','MB Way','Dinheiro','Pagamento Recorrente') then
      raise exception 'Forma de pagamento inválida';
    end if;
    if p_produto = 'PVE' and p_forma not in ('À vista','Cartão - à vista','Klarna') then
      raise exception 'PVE só permite pagamento à vista ou Klarna.';
    end if;
    if p_forma = 'Pagamento Recorrente' and parc < 2 then raise exception 'Pagamento recorrente precisa de 2 ou mais parcelas'; end if;
    if p_forma <> 'Pagamento Recorrente' then parc := 1; end if;
    cl := coalesce(c.closer_id, case when papel = 'closer' then public.current_member_id() end);
    if cl is null then raise exception 'Define o closer antes (marca a call)'; end if;
    pago := case when p_forma in ('Klarna') then p_ticket else coalesce(p_pago, case when p_forma <> 'Pagamento Recorrente' then p_ticket else 0 end) end;
    vp := case when p_forma = 'Pagamento Recorrente' then round(p_ticket / parc, 2) else 0 end;
    insert into public.vendas(data, nome_cliente, email, tel, closer_id, sdr_id, ticket, pago, forma_pagamento,
      parcelas, valor_parcela, is_sinal, produto, notas)
    values (current_date, c.nome, c.email, c.tel, cl, c.sdr_id, p_ticket, pago, p_forma, parc, vp, false,
      coalesce(p_produto,'Europa Digital Academy'), 'Via Funil')
    returning * into v;
    if p_forma = 'Pagamento Recorrente' then
      insert into public.alunos_recorrentes(nome, email, whatsapp, data_entrada, valor_total, valor_parcela, parcelas,
        metodo_pagamento, status_pagamento, parcelas_status)
      values (c.nome, c.email, c.tel, current_date, p_ticket, vp, parc, p_forma,
        case when pago >= p_ticket then 'Pago' else 'Em curso' end,
        (select jsonb_agg(case when vp * i <= pago + 0.001 then 'Pago' else 'Pendente' end order by i)
           from generate_series(1, parc) i));
    end if;
  end if;
  update public.funil_cards set etapa = 'venda', etapa_em = now(), venda_id = v.id,
    closer_id = coalesce(closer_id, v.closer_id), pagamento = p_forma, parcelas = parc
  where id = p_id returning * into c;
  perform public._funil_log(c, 'mover', de, 'venda', jsonb_build_object('ticket', v.ticket));
  return c;
end $$;

-- Números por pessoa e por dia. Fundadores veem todos; os outros só os seus.
create or replace function public.funil_metricas(p_from date, p_to date, p_member uuid default null)
returns table(member_id uuid, nome text, role text, dia date, ligacoes bigint, mensagens bigint, contactos bigint,
  novos bigint, qualificados bigint, marcadas bigint, realizadas bigint, noshows bigint, followups bigint,
  sinais bigint, vendas bigint)
language sql stable security definer set search_path = public as $$
  with alvo as (
    select case when public.funil_papel() = 'socio' then p_member else public.current_member_id() end as m
  ), ev as (
    select e.*, (e.em at time zone 'Europe/Lisbon')::date as d,
           coalesce(e.card_id::text, e.card_nome) as k
    from public.funil_eventos e, alvo
    where public.funil_papel() is not null
      and (e.em at time zone 'Europe/Lisbon')::date between p_from and p_to
      and (alvo.m is null or e.member_id = alvo.m)
  ), primeira as (
    -- só conta a primeira vez que cada cartão entrou numa etapa (por quem a fez)
    select distinct on (k, para) * from ev where tipo in ('criado','mover') order by k, para, em
  )
  select m.id, m.nome, m.role::text, x.d,
    count(*) filter (where x.src = 'ev' and x.tipo = 'ligacao'),
    count(*) filter (where x.src = 'ev' and x.tipo = 'mensagem'),
    count(distinct x.k) filter (where x.src = 'ev' and x.tipo in ('ligacao','mensagem')),
    count(*) filter (where x.src = 'pr' and x.para = 'novo'),
    count(*) filter (where x.src = 'pr' and x.para = 'qualificado'),
    count(*) filter (where x.src = 'pr' and x.para = 'call'),
    count(*) filter (where x.src = 'pr' and x.para = 'realizada'),
    count(*) filter (where x.src = 'pr' and x.para = 'noshow'),
    count(*) filter (where x.src = 'pr' and x.para = 'followup'),
    count(*) filter (where x.src = 'pr' and x.para = 'sinal'),
    count(*) filter (where x.src = 'pr' and x.para = 'venda')
  from (
    select 'ev' as src, member_id, d, k, tipo, para from ev
    union all
    select 'pr', member_id, d, k, tipo, para from primeira
  ) x
  join public.members m on m.id = x.member_id
  group by m.id, m.nome, m.role, x.d
  order by x.d desc, m.nome
$$;

-- Últimos movimentos (feed de atividade)
create or replace function public.funil_atividade(p_limit integer default 30)
returns table(id bigint, card_id uuid, card_nome text, member_id uuid, membro text, tipo text, de text, para text, em timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.card_id, e.card_nome, e.member_id, m.nome, e.tipo, e.de, e.para, e.em
  from public.funil_eventos e left join public.members m on m.id = e.member_id
  where public.funil_papel() is not null
    and (public.funil_papel() = 'socio' or e.member_id = public.current_member_id())
  order by e.em desc limit least(coalesce(p_limit,30), 200)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'funil_criar(text,text,text,text,text,text,text)','funil_atualizar(uuid,jsonb)',
    'funil_registar_contacto(uuid,text)','funil_mover(uuid,text,date)',
    'funil_marcar_call(uuid,uuid,timestamptz,timestamptz,text)','funil_sair(uuid,text,text)',
    'funil_reativar(uuid)','funil_registar_sinal(uuid,numeric,numeric,date,text)',
    'funil_registar_venda(uuid,numeric,text,integer,numeric,text)','funil_metricas(date,date,uuid)',
    'funil_atividade(integer)','funil_papel()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
