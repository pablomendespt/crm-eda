-- Funil comercial (quadro Kanban): cartões, histórico de movimentos e agenda de calls.
-- Tabelas novas, vazias. Nada do que já existia (leads, calls, follow_ups, vendas...) é alterado ou apagado.
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

create table if not exists public.funil_cards (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0),
  tel text, email text, ig text,
  origem text not null default 'Outro',
  localidade text, perfil text, notas text,
  sdr_id uuid references public.members(id),
  closer_id uuid references public.members(id),
  etapa text not null default 'novo' check (etapa in
    ('novo','conversa','qualificado','call','realizada','noshow','followup','sinal','venda','onboarding','aluno')),
  etapa_em timestamptz not null default now(),
  saida text check (saida in ('perdido','desqualificado')),
  saida_motivo text,
  saida_em timestamptz,
  temperatura text check (temperatura in ('Quente','Morno','Frio')),
  objecao text,
  proxima_em date,
  nivel numeric check (nivel is null or nivel > 0),
  pagamento text,
  parcelas integer,
  sinal_valor numeric,
  venda_id uuid references public.vendas(id) on delete set null,
  onboarding_em timestamptz,
  aluno_desde date,
  ligacoes integer not null default 0,
  mensagens integer not null default 0,
  ultimo_contacto_em timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists funil_cards_etapa_idx on public.funil_cards (etapa) where saida is null;
create index if not exists funil_cards_sdr_idx on public.funil_cards (sdr_id);
create index if not exists funil_cards_closer_idx on public.funil_cards (closer_id);

create table if not exists public.funil_agenda (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.funil_cards(id) on delete cascade,
  closer_id uuid not null references public.members(id),
  inicio timestamptz not null,
  fim timestamptz not null,
  estado text not null default 'marcada' check (estado in ('marcada','realizada','noshow','cancelada','remarcada')),
  link text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fim > inicio),
  -- um closer não pode ter duas calls marcadas ao mesmo tempo
  constraint funil_agenda_sem_conflito exclude using gist
    (closer_id with =, tstzrange(inicio, fim) with &&) where (estado = 'marcada')
);
create index if not exists funil_agenda_inicio_idx on public.funil_agenda (inicio);
create index if not exists funil_agenda_card_idx on public.funil_agenda (card_id);

-- Histórico: cada movimento fica registado (quem, quando, de onde para onde). Base das métricas.
create table if not exists public.funil_eventos (
  id bigint generated always as identity primary key,
  card_id uuid references public.funil_cards(id) on delete set null,
  card_nome text not null,
  member_id uuid references public.members(id),
  tipo text not null check (tipo in ('criado','mover','ligacao','mensagem','remarcar','saida','reativar')),
  de text, para text,
  dados jsonb not null default '{}'::jsonb,
  em timestamptz not null default now()
);
create index if not exists funil_eventos_membro_idx on public.funil_eventos (member_id, em);
create index if not exists funil_eventos_card_idx on public.funil_eventos (card_id);

create trigger funil_cards_updated_at before update on public.funil_cards
  for each row execute function public.set_updated_at();
create trigger funil_agenda_updated_at before update on public.funil_agenda
  for each row execute function public.set_updated_at();

-- Cargo para o funil: socio (fundadores/gerência), closer, cs ou sdr
create or replace function public.funil_papel() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when has_role(auth.uid(),'socio'::app_role) or has_role(auth.uid(),'gerencia'::app_role) then 'socio'
    when has_role(auth.uid(),'closer'::app_role) then 'closer'
    when has_role(auth.uid(),'cs'::app_role) then 'cs'
    when has_role(auth.uid(),'sdr'::app_role) then 'sdr'
  end $$;

alter table public.funil_cards enable row level security;
alter table public.funil_agenda enable row level security;
alter table public.funil_eventos enable row level security;

-- Todos veem o quadro. Só os fundadores apagam. Escritas só pelas funções (regras no servidor).
create policy funil_cards_ler on public.funil_cards for select to authenticated using (public.funil_papel() is not null);
create policy funil_cards_apagar on public.funil_cards for delete to authenticated using (public.funil_papel() = 'socio');
create policy funil_agenda_ler on public.funil_agenda for select to authenticated using (public.funil_papel() is not null);
create policy funil_eventos_ler on public.funil_eventos for select to authenticated
  using (public.funil_papel() = 'socio' or member_id = public.current_member_id());

revoke all on public.funil_cards, public.funil_agenda, public.funil_eventos from anon, public;
grant select on public.funil_cards, public.funil_agenda, public.funil_eventos to authenticated;
grant delete on public.funil_cards to authenticated;

-- Tempo real: o quadro e a agenda atualizam sozinhos nos ecrãs abertos.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.funil_cards, public.funil_agenda,
  public.vendas, public.cobrancas, public.members, public.metas_config, public.sdr_daily, public.closer_daily;
