-- Признак работников хранится отдельно от процента уменьшения: для УСН
-- «Доходы» он задаёт предел 50%, а для УСН Д-Р взносы входят в расходы и
-- процентный предел не применяется.
alter table public.company_tax_year_settings
  add column if not exists has_employees boolean not null default false;

comment on column public.company_tax_year_settings.has_employees is
  'Есть выплаты работникам, относящиеся к деятельности на УСН, в данном налоговом году.';

insert into public.company_tax_year_settings (
  company_id, tax_year, has_employees, insurance_reduction_limit_percent, note
)
select
  id,
  2026,
  lower(trim(name)) in ('ооо рио', 'ооо глобалкос', 'ооо иллюмей', 'ип панкратов'),
  case
    when lower(trim(name)) in ('ооо рио', 'ооо глобалкос', 'ооо иллюмей', 'ип панкратов') then 50
    else 100
  end,
  'Признак сотрудников подтверждён владельцем 24.09.2026'
from public.companies
where is_active = true
on conflict (company_id, tax_year) do update set
  has_employees = excluded.has_employees,
  insurance_reduction_limit_percent = excluded.insurance_reduction_limit_percent,
  updated_at = now();
