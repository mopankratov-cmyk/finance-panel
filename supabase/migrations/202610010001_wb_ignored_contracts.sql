-- Закрытые или ошибочно попавшие в выгрузку договоры WB не являются
-- задолженностью панели. Храним исключение отдельно от исходных строк WB:
-- отчёт остаётся аудируемым и номер можно вернуть в сверку при необходимости.
create table if not exists public.loan_marketplace_ignored_contracts (
  marketplace text not null check (marketplace in ('wb', 'ozon')),
  contract_number text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (marketplace, contract_number)
);

alter table public.loan_marketplace_ignored_contracts enable row level security;
revoke all on public.loan_marketplace_ignored_contracts from anon, authenticated;
grant all on public.loan_marketplace_ignored_contracts to service_role;

comment on table public.loan_marketplace_ignored_contracts is
  'Номера договоров маркетплейсов, исключённые из очереди сверки без удаления исходных удержаний.';
