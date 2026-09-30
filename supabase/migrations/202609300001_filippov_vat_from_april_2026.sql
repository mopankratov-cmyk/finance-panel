-- ИП Филиппов применяет НДС с 01.04.2026.
-- Идемпотентно заполняем дату только если профиль ещё не настроен,
-- чтобы не перезаписать ручную корректировку бухгалтера.
do $set_filippov_vat_start$
declare
  v_company_id uuid;
begin
  select id into v_company_id
  from public.companies
  where lower(name) like '%филиппов%'
  order by is_active desc nulls last, name
  limit 1;

  if v_company_id is not null then
    insert into public.company_tax_profiles(company_id, vat_effective_from)
    values (v_company_id, date '2026-04-01')
    on conflict (company_id) do update
      set vat_effective_from = excluded.vat_effective_from
      where public.company_tax_profiles.vat_effective_from is null;
  end if;
end;
$set_filippov_vat_start$;
