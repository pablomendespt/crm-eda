-- Histórico de sinais (aba Vendas > Sinais). Aplicado em 18/10/2026 no banco Supabase vuqbuuvtcxiongzhwtqz.
create table if not exists public.vendas_sinal_hist (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid,
  nome_cliente text not null,
  closer_id uuid,
  sdr_id uuid,
  produto text,
  data_sinal date,
  sinal_recebido numeric not null default 0,
  valor_total_previsto numeric,
  data_prevista_fecho date,
  resultado text not null check (resultado in ('fechado','cancelado')),
  fechado_em date not null default (now() at time zone 'Europe/Lisbon')::date,
  valor_final numeric,
  created_at timestamptz not null default now()
);
alter table public.vendas_sinal_hist enable row level security;
-- Políticas: sócios/gerência veem tudo; closer/SDR veem os próprios.
-- Trigger tg_vendas_sinal_hist grava 'fechado' (is_sinal true->false) e 'cancelado' (delete de sinal).
