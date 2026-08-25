-- Сводка реестра кодов маркировки одним запросом. ОДНА функция на файл.
--
-- Раньше вкладка тянула ВЕСЬ реестр страницами по тысяче и складывала статусы
-- в памяти процесса: одиннадцать тысяч строк — дюжина запросов на каждое
-- открытие экрана, и потолок, за которым это перестало бы работать вовсе.
--
-- p_entity is null — весь реестр: так смотрит владелец и так пишет журнал
-- ночной прогон.
--
-- Срок вывода — три рабочих дня. Считаем календарно с запасом: пять дней
-- покрывают три рабочих с выходными, а завысить просрочку хуже, чем занизить.
-- Код без даты продажи считаем свежим: возраст неизвестен, и обвинять систему
-- в просрочке на пустом месте дороже, чем пропустить один код.
--
-- Часовой пояс закреплён явно. Прежний расчёт в JS брал UTC-дату всегда, и
-- незакреплённый current_date однажды сместил бы границы на сутки при смене
-- настройки сессии или роли.

create or replace function public.kiz_summary(p_entity uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
set timezone = 'UTC'
as $fn$
  with scope as (
    select status, price, sold_at
      from public.kiz_withdrawals
     where p_entity is null or legal_entity_id = p_entity
  ),
  pending as (select * from scope where status = 'sold')
  select jsonb_build_object(
    'pending',            (select count(*) from pending),
    'pendingAmount',      (select coalesce(sum(price), 0) from pending),
    'withoutPrice',       (select count(*) from pending where price is null),
    'sent',               (select count(*) from scope where status = 'sent'),
    'returned',           (select count(*) from scope where status = 'returned'),
    'returnedAfterSent',  (select count(*) from scope where status = 'returned_after_sent'),
    'fbw',                (select count(*) from scope where status = 'fbw'),
    'withdrawn',          (select count(*) from scope where status = 'withdrawn'),
    'unknown',            (select count(*) from scope where status = 'unknown'),
    'firstSoldAt',        (select min(sold_at)::text from scope where sold_at is not null),
    'lastSoldAt',         (select max(sold_at)::text from scope where sold_at is not null),
    'overdue',            (select count(*) from pending where sold_at is not null and sold_at < current_date - 5),
    'ageOverdue',         (select count(*) from pending where sold_at is not null and sold_at < current_date - 5),
    'ageLastDay',         (select count(*) from pending where sold_at is not null and sold_at >= current_date - 5 and sold_at < current_date - 4),
    'ageTwoDays',         (select count(*) from pending where sold_at is not null and sold_at >= current_date - 4 and sold_at < current_date - 2),
    'ageFresh',           (select count(*) from pending where sold_at is null or sold_at >= current_date - 2),
    'noEntity',           (select count(*) from public.kiz_withdrawals where legal_entity_id is null and status = 'sold')
  );
$fn$;

revoke all on function public.kiz_summary(uuid) from public;
grant execute on function public.kiz_summary(uuid) to service_role;

notify pgrst, 'reload schema';
