alter table public.balance_marketplace_cash_snapshots
  add column if not exists calculation_method text not null default 'provider_balance',
  add column if not exists calculation_details jsonb;

alter table public.balance_marketplace_cash_snapshots
  drop constraint if exists balance_marketplace_cash_snapshots_calculation_method_check,
  add constraint balance_marketplace_cash_snapshots_calculation_method_check
    check (calculation_method in ('provider_balance', 'brand_report_allocation'));

comment on column public.balance_marketplace_cash_snapshots.calculation_method is
  'provider_balance — прямой баланс отдельного кабинета; brand_report_allocation — расчёт наших брендов из итогов недельных отчётов общего seller.';
comment on column public.balance_marketplace_cash_snapshots.calculation_details is
  'Аудируемая детализация расчёта: отчёты, доля брендов, сроки доступности и ожидаемого поступления в банк.';

comment on column public.balance_marketplace_cash_snapshots.amount is
  'Средства выбранного юрлица у маркетплейса. Для общего seller рассчитываются только наши бренды по недельным отчётам.';
