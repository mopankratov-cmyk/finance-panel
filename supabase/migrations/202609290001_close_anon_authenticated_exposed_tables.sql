-- Аудит панели 29.09.2026 (находка №3): часть таблиц public так и не получила
-- ту же защиту от anon/authenticated, что стоит у остальных. 202607310002
-- разом закрыла все таблицы, существовавшие на тот момент, — но таблицы,
-- заведённые ПОСЛЕ той миграции, снова получают дефолтные PostgREST-права
-- anon/authenticated, если конкретная миграция явно их не отзывает. Здесь —
-- 18 таких таблиц, которые сегодня либо реально читаются/пишутся публичным
-- анонимным ключом, либо остаются закрытыми только по случайности (RLS
-- включена, но политики нет вовсе — а это ломается тихо в момент, когда
-- кто-то добавит политику по образцу соседней таблицы, не подумав про grant).
--
-- Группа 1 — «Полки» (мониторинг конкурентов): созданы вовсе без public.-
-- квалификатора и без alter table ... enable row level security. Сегодня
-- читаются и пишутся anon/authenticated без единой проверки — самый
-- широкий разрыв из всех, что нашёл аудит.
alter table public.wb_shelf_watch enable row level security;
alter table public.wb_shelf_cabinet_settings enable row level security;
alter table public.wb_shelf_snapshots enable row level security;
alter table public.wb_shelf_snapshot_rows enable row level security;
alter table public.wb_sku_order enable row level security;
revoke all on public.wb_shelf_watch, public.wb_shelf_cabinet_settings,
  public.wb_shelf_snapshots, public.wb_shelf_snapshot_rows, public.wb_sku_order
  from anon, authenticated;
grant all on public.wb_shelf_watch, public.wb_shelf_cabinet_settings,
  public.wb_shelf_snapshots, public.wb_shelf_snapshot_rows, public.wb_sku_order
  to service_role;

-- Группа 2 — кэш и расход рекламы Ozon: RLS включена, но политика названа
-- «service role manages …» и НЕ имеет `to service_role` — значит действует
-- на PUBLIC, то есть и на anon/authenticated, а называется так, будто уже
-- закрыта. Ровно этот же паттерн скопирован 5 раз подряд по мере добавления
-- новых Ozon-таблиц — снимаем политику вместо того, чтобы поправить
-- название: у 93 корректно защищённых таблиц в этом репозитории политики для
-- service_role нет вовсе (он обходит RLS по роли), только revoke/grant —
-- этот же паттерн последовательнее, чем чинить формулировку в пяти местах.
drop policy if exists "service role manages ozon cockpit cache" on public.ozon_cockpit_cache;
drop policy if exists "service role manages ozon ad daily" on public.ozon_ad_daily;
drop policy if exists "service role manages ozon accrual rows" on public.ozon_accrual_rows;
drop policy if exists "service role manages ozon postings" on public.ozon_postings;
drop policy if exists "service role manages ozon accrual types" on public.ozon_accrual_types;
revoke all on public.ozon_cockpit_cache, public.ozon_ad_daily, public.ozon_accrual_rows,
  public.ozon_postings, public.ozon_accrual_types
  from anon, authenticated;
grant all on public.ozon_cockpit_cache, public.ozon_ad_daily, public.ozon_accrual_rows,
  public.ozon_postings, public.ozon_accrual_types
  to service_role;

-- Группа 3 — зарплата и займы: RLS включена, политики нет вовсе — сегодня
-- это фактически deny-all и для anon/authenticated тоже, но только потому,
-- что политики нет. Табличные grant на anon/authenticated при этом никто не
-- отзывал: как только на любой из этих таблиц (например, по образцу другой
-- payroll-таблицы) появится политика `using (true)`, доступ откроется тихо,
-- без единой ошибки — ровно так уже случилось с группой 2. Отзываем grant
-- заранее, вторым рубежом защиты, а не постфактум.
revoke all on public.payroll_employees, public.payroll_periods, public.payroll_entries,
  public.payroll_debt_openings, public.payroll_payment_allocations, public.payroll_employee_private,
  public.finance_loan_documents, public.loan_schedule_rows
  from anon, authenticated;
grant all on public.payroll_employees, public.payroll_periods, public.payroll_entries,
  public.payroll_debt_openings, public.payroll_payment_allocations, public.payroll_employee_private,
  public.finance_loan_documents, public.loan_schedule_rows
  to service_role;
