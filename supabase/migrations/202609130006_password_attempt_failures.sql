-- Смена пароля не ограничивала подбор ТЕКУЩЕГО пароля (аудит P2).
--
-- app/api/auth/password/route.ts проверяет присланный currentPassword через
-- bcrypt.compare без какого-либо предела попыток. Куки сессии живут неделю
-- (см. lib/auth/session.ts) и не привязаны к IP — если кука украдена (XSS,
-- оставленный открытым чужой браузер), но сам пароль атакующему неизвестен,
-- он мог подбирать его этим же роутом сколько угодно раз: смена пароля не
-- требует ничего, кроме валидной сессии и правильного currentPassword.
--
-- Отдельная таблица, а не Redis/Upstash — в проекте нет внешней инфры для
-- лимитов, а строка на пользователя не требует её: это разовая проверка при
-- смене пароля, не поток запросов.
create table if not exists public.password_attempt_failures (
  -- Один пользователь — одна строка. Учётка удалена — лимит удалять не за чем.
  uid           uuid primary key references public.app_users(id) on delete cascade,
  failed_count  int not null default 0,
  -- NULL — блокировки нет. Заполнено и в будущем — попытки отклоняются без
  -- обращения к bcrypt.compare (см. route.ts).
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);

comment on table public.password_attempt_failures is
  'Счётчик неудачных проверок ТЕКУЩЕГО пароля в POST /api/auth/password. 5 подряд неверных — блокировка на 15 минут (see route.ts): защита от подбора живой украденной сессией. Успешная смена пароля обнуляет счётчик.';

alter table public.password_attempt_failures enable row level security;
revoke all on table public.password_attempt_failures from anon, authenticated;
revoke all on table public.password_attempt_failures from service_role;
-- Delete не нужен: счётчик обнуляется через update (failed_count = 0,
-- locked_until = null), а не через удаление строки.
grant select, insert, update on table public.password_attempt_failures to service_role;

notify pgrst, 'reload schema';
