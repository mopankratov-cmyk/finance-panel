-- Публичная кадровая информация нужна в разделе «Штат».
-- Контакты и даты рождения остаются в закрытой директорской таблице.
alter table public.payroll_employees
  add column if not exists employment_details text,
  add column if not exists company_ids uuid[] not null default '{}'::uuid[];

-- Сохраняем уже выбранную основную компанию в новом списке, не теряя связи.
update public.payroll_employees
set company_ids = array[company_id]
where company_id is not null and cardinality(company_ids) = 0;

alter table public.payroll_employee_private
  add column if not exists work_email text,
  add column if not exists birth_date date;

comment on column public.payroll_employees.employment_details is 'Исходная формулировка типа трудоустройства из кадрового реестра.';
comment on column public.payroll_employees.company_ids is 'Компании, на которые работает сотрудник. Первая — основная для новой строки ведомости.';
comment on column public.payroll_employee_private.work_email is 'Рабочая почта сотрудника; доступна только директорскому API.';
comment on column public.payroll_employee_private.birth_date is 'Дата рождения сотрудника; доступна только директорскому API.';
