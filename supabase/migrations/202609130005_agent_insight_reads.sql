-- agent_insights.is_read — один булев на всю строку, а не на пользователя.
--
-- GET/PATCH /api/agent/insights (app/api/agent/insights/route.ts) читали и
-- писали общий столбец is_read. Как только инсайтами пользуется больше
-- одного человека — а в организации всегда несколько внутренних сотрудников,
-- и у внешнего контура своя организация со своим набором читателей — прочтение
-- одним человеком (или нажатие «прочитать всё») тут же гасило непрочитанные
-- ВСЕМ: чужим внутренним командам и чужим клиентским организациям, которые
-- смотрят те же строки через свой разрез cabinet_id. Бейдж непрочитанного на
-- дашборде переставал что-либо значить уже при втором живом пользователе.
--
-- Отдельная таблица (user_id, insight_id) вместо колонки на app_users или
-- agent_insights: прочтение — это связь многие-ко-многим (один инсайт видят
-- многие пользователи, один пользователь видит многие инсайты), а не свойство
-- ни одной из двух сторон.
create table if not exists public.agent_insight_reads (
  user_id    uuid not null references public.app_users(id) on delete cascade,
  insight_id bigint not null references public.agent_insights(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (user_id, insight_id)
);

comment on table public.agent_insight_reads is
  'Прочтение инсайта КОНКРЕТНЫМ пользователем. Источник истины для «прочитано» вместо agent_insights.is_read (тот столбец — общий на всю компанию и не годится, когда читателей больше одного). Столбец не удалён ради отката на время выкладки.';

-- RLS: доступ и здесь идёт через service_role в app/api/agent/insights/route.ts,
-- как и у agent_insights — прямого anon/authenticated пути в эту таблицу нет.
alter table public.agent_insight_reads enable row level security;
revoke all privileges on public.agent_insight_reads from anon, authenticated;

notify pgrst, 'reload schema';
