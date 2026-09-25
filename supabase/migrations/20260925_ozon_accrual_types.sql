-- Кэш справочника категорий начислений Ozon (/v1/finance/accrual/types).
--
-- Кабинето-независим: это категории Ozon вообще, не конкретного продавца.
-- Используется только для подписи строк детализации отчёта человекочитаемым
-- именем — раздел, в который попадает начисление, определяется структурно
-- (см. lib/ozon/opiuOzonReport.ts), а не по этому справочнику, так что
-- отсутствие свежей записи здесь не ломает сумму отчёта, только подпись
-- одной строки (см. docs/superpowers/specs/2026-09-25-ozon-opiu-report-design.md §5).
create table if not exists public.ozon_accrual_types (
  type_id     int not null primary key,
  name        text not null,
  description text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.ozon_accrual_types enable row level security;
drop policy if exists "service role manages ozon accrual types" on public.ozon_accrual_types;
create policy "service role manages ozon accrual types"
  on public.ozon_accrual_types for all using (true) with check (true);
