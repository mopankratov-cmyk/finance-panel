-- Движок тенденций, этап 4: спрос WB как собственная история.
--
-- Частотность поисковых запросов предмета WB (MPSTATS) отдаётся одним ответом
-- ~10 МБ за 30–90 секунд — в запросе пользователя её не дождаться, и тратить на
-- это квоту при каждом открытии экрана нельзя. Раз в неделю сборщик снимает по
-- каждому предмету раздела верх списка запросов (по частотности) и кладёт сюда.
-- Экран читает только эту таблицу; у MPSTATS на открытие ничего не просит.
--
-- Строка = предмет × дата, на которую снята частотность. wb_count у MPSTATS —
-- снимок на конец окна (window_to), а не сумма за период, поэтому ключ — дата
-- конца. «Прошлый» срез для роста — запись примерно на 30 дней раньше.
--
-- Только добавление, ничего существующего не меняет.

create table if not exists public.assortment_wb_query_snapshot (
  subject_id integer not null,
  window_to date not null,
  window_from date not null,
  direction text not null check (direction in ('jackets', 'bags')),
  subject_name text not null,
  -- Верх списка по частотности: массив троек [запрос, wb_count, items_count|null].
  queries jsonb not null,
  -- Сколько запросов вернул MPSTATS и сколько оставили (верх по частотности).
  rows_total integer not null,
  rows_kept integer not null,
  taken_at timestamptz not null default now(),
  primary key (subject_id, window_to)
);

create index if not exists assortment_wb_query_snapshot_direction_idx
  on public.assortment_wb_query_snapshot (direction, window_to desc);

alter table public.assortment_wb_query_snapshot enable row level security;
revoke all on public.assortment_wb_query_snapshot from anon, authenticated;
