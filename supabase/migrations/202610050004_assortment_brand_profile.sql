-- Движок тенденций, этап 1: профиль бренда.
--
-- Аудитория, подходящие и неподходящие формы, сезоны, палитра — решение
-- владельца, а не вывод из данных. Три строки-черновика: NORVIA, HEATON, CLÉRIN.
-- В них заполнено только то, что уже есть в коде: как бренд назван в поле бренда
-- WB (по нему движок находит свои карточки). Всё остальное пусто, пока владелец
-- не внесёт. HEATON и NORVIA — два отдельных профиля: артикул HT- бренд не
-- определяет.
--
-- Ничего существующего не меняет. Организации и кабинеты не дублируются —
-- профиль привязан к бренду WB, а права доступа — прежние роли модуля.

create table if not exists public.assortment_brand_profile (
  brand_key text primary key,
  direction text not null check (direction in ('jackets', 'bags')),
  display_name text not null,
  -- Как бренд назван в поле бренда WB (регистр не важен) — меняется только миграцией.
  wb_brand_names text[] not null default '{}',
  audience text,
  -- Ключи форм из lib/assortment/forms.ts; не в обоих списках — «не решено».
  fit_forms text[] not null default '{}',
  avoid_forms text[] not null default '{}',
  seasons text[] not null default '{}',
  palette text,
  notes text,
  source_ref text,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_at timestamptz,
  confirmed_by text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.assortment_brand_profile enable row level security;
revoke all on public.assortment_brand_profile from anon, authenticated;

insert into public.assortment_brand_profile (brand_key, direction, display_name, wb_brand_names)
values
  ('norvia', 'jackets', 'NORVIA', array['NORVIA']),
  ('heaton', 'jackets', 'HEATON', array['HEATON']),
  ('clerin', 'bags', 'CLÉRIN', array['CLÉRIN', 'CLERIN'])
on conflict (brand_key) do nothing;
