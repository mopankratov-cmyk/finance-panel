-- Явная связь номера кредита из отчёта маркетплейса с договором панели.
-- Нужна для старых договоров WB, у которых номер не был сохранён при импорте.
create table if not exists public.loan_marketplace_contract_links (
  marketplace text not null check (marketplace in ('wb', 'ozon')),
  contract_number text not null,
  loan_id uuid not null references public.loans(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (marketplace, contract_number)
);

create index if not exists loan_marketplace_contract_links_loan_idx
  on public.loan_marketplace_contract_links (loan_id);

alter table public.loan_marketplace_contract_links enable row level security;
revoke all on public.loan_marketplace_contract_links from anon, authenticated;
grant all on public.loan_marketplace_contract_links to service_role;

comment on table public.loan_marketplace_contract_links is
  'Ручное, проверенное сопоставление номера кредита из отчёта WB/Ozon с договором finance-panel.';
