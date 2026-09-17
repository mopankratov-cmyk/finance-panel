alter table public.companies
  add column if not exists tax_rate numeric(6, 3),
  add column if not exists tax_additional_rate numeric(6, 3);

alter table public.companies
  drop constraint if exists companies_tax_rate_check,
  add constraint companies_tax_rate_check check (
    tax_rate is null or tax_rate between 0 and 100
  ),
  drop constraint if exists companies_tax_additional_rate_check,
  add constraint companies_tax_additional_rate_check check (
    tax_additional_rate is null or tax_additional_rate between 0 and 100
  ),
  drop constraint if exists companies_tax_total_rate_check,
  add constraint companies_tax_total_rate_check check (
    coalesce(tax_rate, 0) + coalesce(tax_additional_rate, 0) <= 100
  );

comment on column public.companies.tax_rate is
  'Main company tax rate in percent; null means not configured or not applicable.';
comment on column public.companies.tax_additional_rate is
  'Additional regional or other company tax rate in percent; null means no additional rate.';

notify pgrst, 'reload schema';
