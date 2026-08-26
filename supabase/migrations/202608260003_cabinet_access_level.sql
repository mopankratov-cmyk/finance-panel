-- Уровень доступа сотрудника В КОНКРЕТНОМ кабинете.
--
-- Проблема, из-за которой это заводится: права были глобальные на пользователя.
-- Роль «внешний селлер» выключала запись везде, и Глеб на СЛОЁНО не мог даже
-- поставить задачу менеджеру — при том что задачи это его работа. Единственным
-- выходом было выдать роль пошире, то есть открыть заодно и всё остальное.
--
-- Список кабинетов у пользователя уже есть (app_users.cabinet_ids). Не хватало
-- ответа на второй вопрос: что именно он там может.
--
-- Два уровня:
--   manager — ведёт работу: задачи, заметки, ярлыки, теги. Всё, что ОПИСЫВАЕТ
--             и планирует, но не меняет деньги в кабинете маркетплейса.
--   lead    — то же плюс управляющие действия: ставки, статусы кампаний, цены.
--
-- Почему граница здесь: ошибка в заметке стоит недоразумения, ошибка в ставке —
-- денег. Разделять по экранам бессмысленно (менеджеру нужны те же экраны),
-- разделять по последствиям — осмысленно.
--
-- Строки нет → уровень не задан, работает прежнее правило по глобальной роли.
-- Это важно: заведение таблицы НЕ должно менять права тех, кого в неё не внесли.
create table if not exists public.cabinet_access (
  user_id    uuid not null references public.app_users(id) on delete cascade,
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  level      text not null check (level in ('manager', 'lead')),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (user_id, cabinet_id)
);

create index if not exists cabinet_access_cabinet_idx on public.cabinet_access (cabinet_id);

comment on table public.cabinet_access is 'Уровень доступа сотрудника в конкретном кабинете. Нет строки — действует глобальная роль.';
comment on column public.cabinet_access.level is 'manager — задачи, заметки, ярлыки; lead — плюс ставки, статусы кампаний, цены.';

alter table public.cabinet_access enable row level security;
revoke all privileges on public.cabinet_access from anon, authenticated;
grant all privileges on public.cabinet_access to service_role;
