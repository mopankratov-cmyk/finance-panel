create table if not exists public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'terminated')),
  employment_type text not null default 'unofficial'
    check (employment_type in ('official', 'unofficial', 'partial', 'individual_entrepreneur', 'self_employed')),
  hire_date date,
  termination_date date,
  employer_name text,
  company_id uuid,
  position text,
  project text,
  city text,
  monthly_salary numeric(14, 2) not null default 0 check (monthly_salary >= 0),
  tax_rate numeric(7, 4) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  default_payment_method text not null default 'card'
    check (default_payment_method in ('card', 'bank_account', 'cash')),
  bank_name text,
  phone text,
  payment_details text,
  payment_details_masked text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payroll_employees
  add column if not exists employment_status text not null default 'active'
    check (employment_status in ('active', 'terminated'));

alter table public.payroll_employees add column if not exists phone text;
alter table public.payroll_employees add column if not exists payment_details text;

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  pay_date date not null unique,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'planned', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_start <= period_end),
  check (extract(day from pay_date) in (5, 20))
);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete restrict,
  official_amount numeric(14, 2) not null default 0 check (official_amount >= 0),
  unofficial_amount numeric(14, 2) not null default 0 check (unofficial_amount >= 0),
  contractor_amount numeric(14, 2) not null default 0 check (contractor_amount >= 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  payment_method text not null default 'card' check (payment_method in ('card', 'bank_account', 'cash')),
  company_id uuid,
  account_id uuid references public.accounts(id) on delete set null,
  salary_payment_id uuid references public.payments(id) on delete set null,
  tax_payment_id uuid references public.payments(id) on delete set null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);

create table if not exists public.payroll_debt_openings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  debt_year integer not null check (debt_year between 2000 and 2100),
  amount numeric(14, 2) not null check (amount >= 0),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, debt_year)
);

create table if not exists public.payroll_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  entry_id uuid references public.payroll_entries(id) on delete cascade,
  debt_opening_id uuid references public.payroll_debt_openings(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  allocation_kind text not null check (allocation_kind in ('current_salary', 'current_year_debt', 'prior_year_debt')),
  comment text,
  confirmed_at timestamptz not null default now(),
  check (num_nonnulls(entry_id, debt_opening_id) = 1)
);

create index if not exists payroll_employees_status_idx on public.payroll_employees(employment_status, termination_date);
create index if not exists payroll_entries_period_idx on public.payroll_entries(period_id);
create index if not exists payroll_entries_employee_idx on public.payroll_entries(employee_id);
create index if not exists payroll_debt_employee_idx on public.payroll_debt_openings(employee_id, debt_year);
create index if not exists payroll_allocations_employee_idx on public.payroll_payment_allocations(employee_id, confirmed_at);
create unique index if not exists payroll_allocations_payment_entry_uq
  on public.payroll_payment_allocations(payment_id, entry_id) where entry_id is not null;
create unique index if not exists payroll_allocations_payment_debt_uq
  on public.payroll_payment_allocations(payment_id, debt_opening_id) where debt_opening_id is not null;

alter table public.payroll_employees enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_debt_openings enable row level security;
alter table public.payroll_payment_allocations enable row level security;

comment on table public.payroll_employees is 'Справочник сотрудников. Полные платёжные реквизиты загружаются пользователем после внедрения и не хранятся в Git.';
comment on table public.payroll_entries is 'Начисления по сотруднику за полумесяц и устойчивые связи с плановыми строками календаря.';

insert into public.payroll_employees (
  full_name, employment_status, employment_type, employer_name, position, project, city, monthly_salary,
  default_payment_method, bank_name, payment_details_masked, notes, termination_date
) values
  ('Ефремова Алина Михайловна', 'active', 'unofficial', 'Нет данных', 'Финансист', 'Все проекты', 'Краснодар', 50000, 'card', 'Сбер', 'Карта •••• 3142', 'Источник: Сотрудники.xlsx', null),
  ('Заляева Анастасия Сергеевна', 'active', 'unofficial', 'Нет данных', 'Менеджер по закупкам', 'Все проекты', 'Казань', 140000, 'card', 'Т-Банк', 'Карта •••• 1427', 'Источник: Сотрудники.xlsx', null),
  ('Камалова Фаягуль Мансуровна', 'active', 'unofficial', null, 'Помощник финансиста', null, 'Набережные Челны', 30000, 'card', 'Альфа-Банк', 'Карта •••• 8526', 'Источник: Сотрудники.xlsx; увольнение с 05.09.2026', '2026-09-05'),
  ('Митриченко Кристина Михайловна', 'active', 'individual_entrepreneur', 'ООО РИО', 'Финансовый директор', 'Все проекты', 'Краснодар', 100000, 'bank_account', 'Сбер', 'Расчётный счёт ИП', 'Источник: Сотрудники.xlsx', null),
  ('Тимошина Евгения Николаевна', 'active', 'self_employed', 'ООО РИО', 'HR', 'Все проекты', 'Ростов-на-Дону', 80000, 'bank_account', 'Сбер', 'Расчётный счёт самозанятого', 'Источник: Сотрудники.xlsx', null),
  ('Шук Оксана Александровна', 'active', 'individual_entrepreneur', 'Нет данных', 'Бухгалтер', 'Все проекты', 'Москва', 0, 'bank_account', 'Т-Банк', 'Расчётный счёт ИП', 'Источник: Сотрудники.xlsx; сумму указывает менеджер', null),
  ('Лушникова Ксения Александрована', 'active', 'self_employed', null, 'Менеджер Ozon', null, null, 120000, 'bank_account', 'Сбер', 'Расчётный счёт самозанятого', 'Источник: Сотрудники.xlsx', null)
on conflict (full_name) do update set
  employment_type = excluded.employment_type,
  employment_status = excluded.employment_status,
  employer_name = excluded.employer_name,
  position = excluded.position,
  project = excluded.project,
  city = excluded.city,
  monthly_salary = excluded.monthly_salary,
  default_payment_method = excluded.default_payment_method,
  bank_name = excluded.bank_name,
  payment_details_masked = excluded.payment_details_masked,
  notes = excluded.notes,
  termination_date = excluded.termination_date,
  updated_at = now();

-- По уточнению пользователя действующими являются только семь сотрудников выше.
-- Остальные строки из исходного файла сохраняются в отдельном списке уволенных.
insert into public.payroll_employees (
  full_name, employment_status, employment_type, hire_date, termination_date,
  employer_name, position, project, city, monthly_salary,
  default_payment_method, bank_name, notes
) values
('Антошевская Анастасия Николаевна', 'terminated', 'individual_entrepreneur', null, null, '', 'Руководитель маркетинга', '', 'Москва', 200000, 'bank_account', '', 'Источник: Сотрудники.xlsx'),
  ('Басалай Дарья Викторовна (разбивка)', 'terminated', 'unofficial', null, null, 'Нет данных', 'Помощник графического дизайнера', 'Все проекты', 'Брест, Беларусь', 70000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Белимов Кирилл Отчество', 'terminated', 'unofficial', null, null, 'Нет данных', 'Менеджер отдела внешней рекламы', 'Все проекты', 'Город', 20000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Белякова Валентина Валентиновна', 'terminated', 'self_employed', '2025-06-02', null, 'ИП Панкратов', 'Руководитель дизайн отдела', '', 'г. Хабаровск', 250000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Бойчук Михаил Алексеевич', 'terminated', 'individual_entrepreneur', '2025-03-01', null, 'ООО Иллюмэй', 'Менеджер Ozon', 'Illymay', 'Город, Мордовия', 150000, 'bank_account', '', 'Источник: Сотрудники.xlsx'),
  ('Грачева Дарья Валерьевна', 'terminated', 'unofficial', '2024-02-13', null, 'Нет данных', 'Проджект-менеджер контент отдела', 'Рио, Cosmos, Clerin', 'Город', 60000, 'card', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Доровских Наталья Николаевна', 'terminated', 'self_employed', '2024-12-10', null, 'Нет данных', 'Менеджер Ozon', 'Illymay', 'Калининград', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Кабаченко Анастасия Сергеевна', 'terminated', 'unofficial', null, null, 'Нет данных', 'Логист', 'Все проекты', 'Екатеринбург', 80000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Катеринина София Отчетство (разбивка)', 'terminated', 'unofficial', null, null, 'Нет данных', 'Помощник графического дизайнера', 'Все проекты', 'Город', 45000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Комарова Карина Владимировна', 'terminated', 'official', '2025-02-24', null, 'ООО РИО', 'Менеджер ВЭД', 'Все проекты', 'Кострома', 110000, 'card', 'ВТБ Банк', 'Источник: Сотрудники.xlsx'),
  ('Конькова Полина Отчество', 'terminated', 'unofficial', null, null, 'Нет данных', 'Менеджер отдела внешней рекламы', 'Все проекты', 'Город', 20000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Кучер Олеся Олеговна', 'terminated', 'official', null, null, 'ООО Иллюмэй', 'Руководитель отдела внешней рекламы', 'Все проекты', 'Москва', 100000, 'card', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Львова Мария Георгиевна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Продуктолог', 'Рио, Cosmos, Clerin', 'Австрия (Архангельск, Санкт-Петербург)', 200000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Макарова Татьяна Владимировна', 'terminated', 'unofficial', '2025-04-30', null, 'Нет данных', 'Менеджер по закупке бартеров', 'Рио, Cosmos, Clerin', 'Рубцовск', 25000, 'card', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Мамиев Герман Муратович', 'terminated', 'unofficial', '2024-08-27', null, 'Нет данных', 'Менеджер отдела внешней рекламы', 'Все проекты', 'Белград, Сербия', 20000, 'card', 'Ozon Банк', 'Источник: Сотрудники.xlsx'),
  ('Лебедева Дарья Андреевна', 'terminated', 'self_employed', null, null, '', 'Креатор', '', 'Москва', 30000, 'bank_account', 'Альфа-Банк', 'Источник: Сотрудники.xlsx'),
  ('Николина Екатерина Павловна', 'terminated', 'individual_entrepreneur', null, null, '', 'Креатор', '', '', 30000, 'bank_account', 'Альфа-Банк', 'Источник: Сотрудники.xlsx'),
  ('Притула Людмила Алексеевна (разбивка)', 'terminated', 'self_employed', null, null, 'ИП Панкратов', 'Менеджер Wildberries', 'Cosmos', 'Усть-Лабинск', 50000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Понтус Виктория Геннадьевна', 'terminated', 'individual_entrepreneur', null, null, '', 'Креатор', '', '', 30000, 'bank_account', 'Точка Банк', 'Источник: Сотрудники.xlsx'),
  ('Ревва Алина Артёмовна', 'terminated', 'unofficial', null, null, 'Нет данных', 'Креатор', 'Все проекты', 'Апшеронск, Краснодарский край', 0, 'card', 'Совкомбанк', 'Источник: Сотрудники.xlsx'),
  ('Романюк Маргарита Валерьевна', 'terminated', 'unofficial', null, null, 'Нет данных', 'Бизнес-ассистент Максима Панкратова', 'Все проекты', 'Новосибирск', 150000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Селифонова Анна Андреевна', 'terminated', 'official', '2025-02-24', null, 'Нет данных', 'Продуктолог', 'Illymay', 'Москва', 150000, 'card', 'Альфа-Банк', 'Источник: Сотрудники.xlsx'),
  ('Симонов Дмитрий Владимирович (разбивка)', 'terminated', 'official', '2024-07-30', null, 'ИП Панкратов', 'Менеджер Wildberries', 'Рио, Cosmos, Clerin', 'Санкт-Петербург', 190000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Степанов Денис Александрович', 'terminated', 'self_employed', '2025-03-01', null, 'Нет данных', 'Разработчик ИИ-ботов', 'Все проекты', 'Крым', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Чернюк Никита Игоревич', 'terminated', 'unofficial', '2025-03-17', null, 'Нет данных', 'Менеджер Ozon', 'Рио, Cosmos, Clerin', 'Город, Беларусь', 80000, 'card', 'Альфа-Банк', 'Источник: Сотрудники.xlsx'),
  ('Понятова Клара Александровна', 'terminated', 'self_employed', '2025-09-09', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Макарчук Мария Николаевна', 'terminated', 'self_employed', '2025-09-03', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Кузнецова Ольга Геннадьевна', 'terminated', 'self_employed', '2025-09-22', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Патрушева Ирина Николаевна', 'terminated', 'self_employed', '2025-09-15', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Бойцова Анастасия Игоревна', 'terminated', 'self_employed', '2025-09-23', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Баженова Надежда Анатольевна', 'terminated', 'self_employed', '2025-09-15', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Озон-Банк', 'Источник: Сотрудники.xlsx'),
  ('Ружич Валентина Александровна', 'terminated', 'self_employed', '2025-09-03', null, '', 'Креатор', '', '', 30000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Матюшина Карина Евгеньевна', 'terminated', 'self_employed', '2025-10-01', null, '', 'Графический дизайнер', '', '', 60000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Калашников Даниил Сергеевич', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Москва', 20000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Гизатулин Леонид Сергеевич', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Анкара, Турция', 40000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Колькова Галина Андреевна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Владивосток', 8000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Земскова Виктория Вадимовна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Пенза', 100000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Буриго Алла Васильевна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Париж/Москва', 60000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Тужекова Галина Егоровна (Татьяна)', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Салават', 15000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Клеймëнова Елена Евгеньевна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Стамбул', 70000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
('Звягинцев Сергей Викторович (разбивка)', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Москва', 100000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Иванчикова Анна Вячеславовна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Москва', 45000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Баскакова Ольга Николаевна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Город Раменское московской области', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Синем Кочак', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Алматы/Стамбул', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Юлия', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'МО,г.Пушкино', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Софья Елисеева', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Москва', 120000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Анна Кострица', 'terminated', 'self_employed', null, '2024-08-05', 'Нет данных', 'Графический дизайнер', '', 'Австралия, Перт / СПБ', 80000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Мехоношина Светлана Сергеевна', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', '/ г. Екатеринбург', 30000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Марченко Софья Олеговна', 'terminated', 'self_employed', null, '2024-08-31', 'Нет данных', 'Графический дизайнер', '', 'Калининград', 20000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Ярослава', 'terminated', 'self_employed', null, null, 'Нет данных', 'Графический дизайнер', '', 'Бийск, иногда в Москве бываю', 45000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Казмерчук Алёна Ивановна', 'terminated', 'self_employed', '2024-09-01', null, 'Нет данных', 'Графический дизайнер', '', '', 20000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Кулиш Людмила Бальжиевна', 'terminated', 'self_employed', '2024-10-23', null, 'Нет данных', 'Графический дизайнер', '', 'Москва', 80000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Ковтун Элеонора Евгеньевна', 'terminated', 'self_employed', '2024-10-25', null, 'Нет данных', 'Графический дизайнер', '', 'г.Армавир', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Ким Лилия Борисовна', 'terminated', 'self_employed', '2024-10-18', null, 'Нет данных', 'Графический дизайнер', '', 'респ.Крым', 85000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Пономарев Даниил Андреевич', 'terminated', 'self_employed', '2024-12-23', null, 'Нет данных', 'Графический дизайнер', '', 'Барнаул', 35000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Юнда Мария Владимировна', 'terminated', 'self_employed', '2025-03-17', null, 'Нет данных', 'Графический дизайнер', '', 'г.Орел', 20000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Мищенко Марина Михайловна', 'terminated', 'self_employed', '2025-03-26', null, 'Нет данных', 'Графический дизайнер', '', '', 50000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Белозерова Владислава Дмитриевна', 'terminated', 'unofficial', '2025-10-22', null, '', 'SMM', '', '', 80000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Костин Даниил Романович', 'terminated', 'unofficial', null, null, '', 'Руководитель контент завода', '', 'Новосибирск', 120000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Соловьев Павел Андреевич', 'terminated', 'individual_entrepreneur', '2026-01-15', null, '', 'Менеджер WB', '', 'Москва', 130000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Ряго Анастасия Максимовна', 'terminated', 'individual_entrepreneur', '2026-02-02', null, '', 'Менеджер WB', '', 'Москва', 150000, 'bank_account', '', 'Источник: Сотрудники.xlsx'),
  ('Уринбаев Тимур Заитжонович', 'terminated', 'unofficial', '2025-09-22', null, '', 'Руководитель фулфилмента', '', 'Москва', 100000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Васильева Ольга Александровна', 'terminated', 'self_employed', '2025-10-01', null, '', 'Менеджер по продаже фулфилмента', '', 'Москва', 100000, 'bank_account', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Саблин Роман Валерьевич', 'terminated', 'official', null, null, '', 'Заведующий складом', 'Все проекты', 'Волжский', 150000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Старостин Максим Владимирович', 'terminated', 'official', null, null, '', 'Кладовщик', 'Все проекты', 'Балашов', 110000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Федотова Янина Юрьевна', 'terminated', 'unofficial', null, null, '', 'Упаковщик', 'Все проекты', 'Лобня', 90000, 'card', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Буренков Евгений Владимирович', 'terminated', 'self_employed', null, null, '', 'Водитель', 'Все проекты', 'Город Москва', 130000, 'bank_account', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Степанов Роман Иванович', 'terminated', 'unofficial', null, null, '', 'Упаковщик', 'Все проекты', 'Великий Новгород', 90000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx'),
  ('Самченко Дмитрий Владимирович', 'terminated', 'self_employed', null, null, '', 'Водитель', 'Все проекты', 'Москва', 150000, 'bank_account', '', 'Источник: Сотрудники.xlsx'),
  ('Вараксин Артем Максимович', 'terminated', 'official', null, null, '', 'Менеджер склада', 'Все проекты', 'Москва', 120000, 'card', 'Сбер', 'Источник: Сотрудники.xlsx'),
  ('Кривцов Павел Александрович', 'terminated', 'unofficial', null, null, '', 'Кладовщик', '', 'Москва', 90000, 'card', 'Ozon Банк', 'Источник: Сотрудники.xlsx'),
  ('Гургенашвили Отар Малхазович', 'terminated', 'official', null, null, '', '', '', 'Москва', 80000, 'card', 'Тинкофф', 'Источник: Сотрудники.xlsx'),
  ('Большова Мария Александровна', 'terminated', 'official', null, null, '', '', '', 'Москва', 50000, 'card', 'сбер', 'Источник: Сотрудники.xlsx'),
  ('Гасанова  Лейла Аслановна', 'terminated', 'official', null, null, '', 'Упаковщица', '', 'Москва', 50000, 'card', 'Сбербанк', 'Источник: Сотрудники.xlsx'),
  ('Бедретдинова Рамиля Рафиковна', 'terminated', 'official', null, null, '', 'Упаковщица', '', 'Москва', 50000, 'card', 'Сбербанк', 'Источник: Сотрудники.xlsx'),
  ('Журавлева Дарья Алексеевна', 'terminated', 'official', null, null, '', 'Упаковщица', '', 'Москва', 50000, 'card', 'Сбербанк', 'Источник: Сотрудники.xlsx'),
  ('Ремесленник Елена Григорьевна', 'terminated', 'official', null, null, '', 'упаковщица', '', 'Москва', 50000, 'card', 'Сбербанк', 'Источник: Сотрудники.xlsx'),
  ('Забродин Антон Анатольевич', 'terminated', 'official', null, null, '', 'упаковщик', '', 'Москва', 50000, 'card', 'ВТБ', 'Источник: Сотрудники.xlsx'),
  ('Гришин Егор Дмитриевич', 'terminated', 'official', null, null, '', 'Кладовщик', '', 'Москва', 70000, 'card', 'Тинкофф', 'Источник: Сотрудники.xlsx'),
  ('Метелкин Николай Иванович', 'terminated', 'unofficial', null, null, '', 'Упаковщик', '', 'Москва', 90000, 'card', 'Т-Банк', 'Источник: Сотрудники.xlsx')
on conflict (full_name) do update set
  employment_status = excluded.employment_status,
  employment_type = excluded.employment_type,
  hire_date = excluded.hire_date,
  termination_date = excluded.termination_date,
  employer_name = excluded.employer_name,
  position = excluded.position,
  project = excluded.project,
  city = excluded.city,
  monthly_salary = excluded.monthly_salary,
  default_payment_method = excluded.default_payment_method,
  bank_name = excluded.bank_name,
  notes = excluded.notes,
  updated_at = now();
