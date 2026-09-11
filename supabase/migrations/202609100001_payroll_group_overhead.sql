-- Общая финансовая группа для зарплатных расходов, которые нельзя честно
-- отнести к одному юрлицу. Это отдельная запись справочника, не юрлицо.
insert into public.companies (name, group_name, is_active)
values
  ('ИП Митриченко', 'РИО / ИП Панкратов / ИП Кучеренко', true),
  ('Общая группа РИО', 'РИО / ИП Панкратов / ИП Кучеренко', true)
on conflict (name) do update
set group_name = excluded.group_name, is_active = true;

update public.companies
set group_name = 'РИО / ИП Панкратов / ИП Кучеренко'
where name in ('ООО РИО', 'ИП Панкратов', 'ИП Кучеренко');
