alter table public.companies
  add column if not exists tax_system text,
  add column if not exists vat_mode text;

alter table public.companies
  drop constraint if exists companies_tax_system_check,
  add constraint companies_tax_system_check check (
    tax_system is null or tax_system in (
      'osno', 'usn_income', 'usn_income_expense', 'ausn_income',
      'ausn_income_expense', 'patent', 'npd', 'eshn'
    )
  ),
  drop constraint if exists companies_vat_mode_check,
  add constraint companies_vat_mode_check check (
    vat_mode is null or vat_mode in ('exempt', '0', '5', '7', '10', '22')
  );

comment on column public.companies.tax_system is
  'Current taxation system used by the company; null means not configured.';
comment on column public.companies.vat_mode is
  'Current VAT setting: exempt or the applicable percentage; null means not configured.';
