-- Пороги согласований, настраиваемые (ТЗ, решения владельца от 09.09.2026).
--
-- Владелец назвал числа и попросил сделать их настраиваемыми: 30 000 ₽ и 5%
-- на расхождение при приёмке, 10 000 ₽ на документ и 30 000 ₽ за месяц на
-- списание. В коде они лежат значениями по умолчанию (lib/auth/approvals.ts),
-- а здесь — то, чем их переопределяют.
--
-- Область хранится отдельной строкой, а не одной записью на всю панель:
-- у внешнего контура свои пороги, и клиент задаёт их сам в своём юрлице
-- (право limits.manage). Компанейские лимиты — строка без организации.
create table if not exists public.access_limits (
  id              bigint generated always as identity primary key,
  -- Пусто — лимиты компании. Заполнено — лимиты этой организации.
  organization_id uuid,
  -- Значения хранятся объектом, а не колонками: список порогов будет расти
  -- (реклама, платежи), и каждый новый повод для миграции — повод его забыть.
  limits          jsonb not null default '{}'::jsonb,
  updated_by      text,
  updated_at      timestamptz not null default now()
);

-- Одна строка на область: вторая означала бы два ответа на один вопрос.
create unique index if not exists access_limits_scope_unique
  on public.access_limits (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table public.access_limits is
  'Пороги, за которыми нужна чужая подпись: расхождение при приёмке, списание по документу и за месяц. Строка без organization_id — лимиты компании; строка с ним — лимиты внешнего клиента, который задаёт их себе сам.';

alter table public.access_limits enable row level security;
revoke all on table public.access_limits from anon, authenticated;
revoke all on table public.access_limits from service_role;
grant select, insert, update on table public.access_limits to service_role;

notify pgrst, 'reload schema';
