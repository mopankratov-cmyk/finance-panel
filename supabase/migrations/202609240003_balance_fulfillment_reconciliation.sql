-- Фулфилмент может провести документ позже фактической даты. Баланс поэтому
-- пересчитывает этот источник по append-only журналу stock_moves, а не по
-- текущему stock_balances: поздняя проводка с occurred_at до границы месяца
-- попадёт в тот же срез, не меняя дату баланса.

alter table public.balance_marketplace_stock_runs
  add column if not exists is_provisional boolean not null default false,
  add column if not exists snapshot_cutoff timestamptz,
  add column if not exists reconciled_at timestamptz;

create or replace function public.balance_fulfillment_as_of(p_cutoff timestamptz)
returns table (
  legal_entity_id uuid,
  warehouse_id uuid,
  warehouse_name text,
  variant_id uuid,
  article text,
  product_name text,
  size_label text,
  qty numeric,
  amount numeric,
  unit_cost numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.legal_entity_id,
    m.warehouse_id,
    max(w.name)::text as warehouse_name,
    m.variant_id,
    max(p.article)::text as article,
    max(p.name)::text as product_name,
    max(v.size_label)::text as size_label,
    sum(m.qty)::numeric as qty,
    sum(m.amount)::numeric as amount,
    case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else null end as unit_cost
  from public.stock_moves m
  join public.warehouses w on w.id = m.warehouse_id
  join public.products p on p.id = m.product_id
  join public.product_variants v on v.id = m.variant_id
  where m.occurred_at < p_cutoff
    and coalesce(w.kind, 'own') <> 'transit'
  group by m.legal_entity_id, m.warehouse_id, m.variant_id
  having sum(m.qty) > 0
  order by max(p.article), max(v.size_label);
$$;

revoke all on function public.balance_fulfillment_as_of(timestamptz) from public;
grant execute on function public.balance_fulfillment_as_of(timestamptz) to service_role;

comment on function public.balance_fulfillment_as_of(timestamptz) is
  'Остаток фулфилмента на точную границу баланса; учитывает поздно внесённые движения с фактической occurred_at.';

notify pgrst, 'reload schema';
