-- Заметки менеджеру в журнале РК: что сделать с этим товаром или кампанией.
--
-- Журнал показывает, что происходило. Решение по нему принимает человек, и
-- оно живёт в голове или в переписке: «поднять ставку», «выключить полки»,
-- «ждём новый контент». Через неделю никто не помнит, что решили и сделали ли.
--
-- Ключ включает advert_id, потому что заметка бывает двух уровней:
--   advert_id = NULL — про товар в этот день целиком;
--   advert_id задан  — про конкретную кампанию этого товара.
-- Нулём его не заменить: ноль был бы «кампания номер ноль», а не «про товар».
-- Поэтому ключ — уникальный индекс с nulls not distinct, а не primary key:
-- обычный ключ не даёт NULL в составе, а PostgREST-upsert целится в колонки.
create table if not exists public.wb_rk_notes (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id      bigint not null,
  advert_id  bigint,
  date       date not null,
  note       text not null,
  -- Сделано: менеджер отмечает выполненное, а не стирает — иначе история
  -- решений пропадает вместе с отметкой.
  done       boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

do $$ begin
  alter table public.wb_rk_notes
    add constraint wb_rk_notes_key
    unique nulls not distinct (cabinet_id, nm_id, advert_id, date);
exception when duplicate_object then null; end $$;

-- Экран читает заметки сразу за всё окно журнала.
create index if not exists wb_rk_notes_window_idx on public.wb_rk_notes (cabinet_id, date);

comment on table public.wb_rk_notes is 'Заметки менеджеру в журнале РК: что сделать с товаром или кампанией в этот день.';
comment on column public.wb_rk_notes.advert_id is 'NULL — заметка про товар целиком; иначе про конкретную кампанию.';
comment on column public.wb_rk_notes.done is 'Отметка «сделано». Заметка остаётся: история решений важнее чистоты списка.';

alter table public.wb_rk_notes enable row level security;
revoke all privileges on public.wb_rk_notes from anon, authenticated;
grant all privileges on public.wb_rk_notes to service_role;
