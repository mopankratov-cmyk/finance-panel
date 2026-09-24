-- Налоговый расчёт на текущую дату: документы маркетплейсов, годовые
-- параметры УСН и назначение банковских платежей.

alter table public.payment_tax_details
  add column if not exists tax_payment_kind text not null default 'operating_expense';

alter table public.payment_tax_details
  drop constraint if exists payment_tax_details_tax_payment_kind_check,
  add constraint payment_tax_details_tax_payment_kind_check check (
    tax_payment_kind in ('operating_expense', 'insurance_contribution', 'usn_tax_payment', 'other_tax')
  );

comment on column public.payment_tax_details.tax_payment_kind is
  'Назначение платежа для налогового расчёта; уплата УСН и страховые взносы не смешиваются с обычными расходами.';

create table if not exists public.company_tax_year_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  tax_year integer not null check (tax_year between 2020 and 2100),
  fixed_insurance_contributions numeric not null default 0 check (fixed_insurance_contributions >= 0),
  insurance_reduction_limit_percent numeric not null default 0
    check (insurance_reduction_limit_percent in (0, 50, 100)),
  prior_year_loss numeric not null default 0 check (prior_year_loss >= 0),
  recognized_cogs numeric not null default 0 check (recognized_cogs >= 0),
  output_vat_confirmed numeric check (output_vat_confirmed is null or output_vat_confirmed >= 0),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, tax_year)
);

comment on table public.company_tax_year_settings is
  'Годовые параметры налогового расчёта. Взносы ИП по статье 430 НК РФ могут уменьшать УСН без ожидания банковской оплаты.';
comment on column public.company_tax_year_settings.insurance_reduction_limit_percent is
  '0 — не уменьшать автоматически, 50 — плательщик с работниками, 100 — ИП без работников.';

create table if not exists public.marketplace_tax_documents (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  marketplace text not null check (marketplace in ('wb', 'ozon', 'other')),
  document_date date not null,
  document_number text not null default '',
  gross_expense_amount numeric not null default 0 check (gross_expense_amount >= 0),
  vat_rate numeric check (vat_rate is null or vat_rate in (0, 5, 7, 10, 20, 22)),
  vat_amount numeric not null default 0 check (vat_amount >= 0),
  vat_document_status text not null default 'missing'
    check (vat_document_status in ('missing', 'received', 'not_required')),
  vat_deduction_status text not null default 'pending'
    check (vat_deduction_status in ('pending', 'eligible', 'not_eligible')),
  usn_expense_status text not null default 'pending'
    check (usn_expense_status in ('pending', 'included', 'excluded')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  check (vat_amount <= gross_expense_amount)
);

comment on table public.marketplace_tax_documents is
  'УПД, счета-фактуры и закрывающие документы маркетплейсов. Только подтверждённые строки участвуют в вычете НДС и расходах УСН.';

create index if not exists marketplace_tax_documents_company_date_idx
  on public.marketplace_tax_documents(company_id, document_date);

-- WB передаёт точный НДС своего вознаграждения. Он служит контролем отчёта,
-- но вычет всё равно подтверждается УПД/счётом-фактурой в регистре выше.
alter table public.wb_report_rows
  add column if not exists ppvz_vw numeric,
  add column if not exists ppvz_vw_nds numeric;

create or replace function public.tax_wb_input_vat(
  p_cabinet_ids text[],
  p_from date,
  p_to date
) returns numeric
language sql
stable
set search_path = public
as $$
  select greatest(coalesce(sum(ppvz_vw_nds), 0), 0)
  from public.wb_report_rows
  where cabinet_id::text = any(p_cabinet_ids)
    and rr_dt >= p_from
    and rr_dt <= p_to;
$$;

revoke all on function public.tax_wb_input_vat(text[], date, date) from public, anon, authenticated;
grant execute on function public.tax_wb_input_vat(text[], date, date) to service_role;

alter table public.company_tax_year_settings enable row level security;
alter table public.marketplace_tax_documents enable row level security;
revoke all on public.company_tax_year_settings, public.marketplace_tax_documents from anon, authenticated;
grant all on public.company_tax_year_settings, public.marketplace_tax_documents to service_role;

-- Контрольная настройка из расчёта бухгалтера Филиппова на 2026 год:
-- официальный УСН остаётся 1%, фиксированные взносы уменьшают налог, а
-- tax_additional_rate=1% показывается отдельно как расход льготного региона.
insert into public.company_tax_year_settings (
  company_id, tax_year, fixed_insurance_contributions,
  insurance_reduction_limit_percent, note
)
select id, 2026, 57390, 100,
  'Фиксированные взносы ИП 2026; дополнительный 1% не входит в налог ФНС'
from public.companies
where lower(name) like '%филиппов%'
on conflict (company_id, tax_year) do nothing;
