-- Налоговая квалификация платежа хранится отдельно от ДДС: одна и та же
-- банковская операция остаётся фактом движения денег, а бухгалтер независимо
-- отмечает условия признания расхода и вычета НДС.
create table if not exists public.payment_tax_details (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  vat_rate numeric,
  vat_amount numeric not null default 0 check (vat_amount >= 0),
  vat_document_status text not null default 'missing'
    check (vat_document_status in ('missing', 'received', 'not_required')),
  vat_deduction_status text not null default 'pending'
    check (vat_deduction_status in ('pending', 'eligible', 'not_eligible')),
  usn_expense_status text not null default 'pending'
    check (usn_expense_status in ('pending', 'included', 'excluded')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  check (vat_rate is null or vat_rate in (0, 5, 7, 10, 20, 22))
);

comment on table public.payment_tax_details is
  'Регистр налоговой квалификации фактических платежей ДДС; pending никогда не включается в налоговый расчёт автоматически.';
comment on column public.payment_tax_details.vat_document_status is
  'received означает, что счёт-фактура/УПД получен и проверен; назначение банка само по себе документ не заменяет.';
comment on column public.payment_tax_details.usn_expense_status is
  'included ставится только после проверки оплаты, документального подтверждения и связи расхода с деятельностью.';

create index if not exists payment_tax_details_usn_status_idx
  on public.payment_tax_details(usn_expense_status, vat_deduction_status);

alter table public.payment_tax_details enable row level security;
revoke all on public.payment_tax_details from anon, authenticated;
grant all on public.payment_tax_details to service_role;

-- НДС может начаться не с 1 января (например, после утраты освобождения).
-- Дата хранится отдельно от общей карточки компании, чтобы не менять
-- совместимость старых установок finance-panel.
create table if not exists public.company_tax_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  vat_effective_from date,
  updated_at timestamptz not null default now()
);

comment on column public.company_tax_profiles.vat_effective_from is
  'Первая дата, с которой выручка компании облагается НДС; null означает начало выбранного года.';

-- В отчёте МП видна стоимость услуг, но вычет возникает только после проверки
-- УПД/счёта-фактуры. Поэтому подтверждённая бухгалтером сумма хранится отдельно.
create table if not exists public.company_tax_periods (
  company_id uuid not null references public.companies(id) on delete cascade,
  period_key text not null check (period_key ~ '^\\d{4}-Q[1-4]$'),
  marketplace_input_vat_confirmed numeric not null default 0
    check (marketplace_input_vat_confirmed >= 0),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, period_key)
);

alter table public.company_tax_profiles enable row level security;
alter table public.company_tax_periods enable row level security;
revoke all on public.company_tax_profiles, public.company_tax_periods from anon, authenticated;
grant all on public.company_tax_profiles, public.company_tax_periods to service_role;
