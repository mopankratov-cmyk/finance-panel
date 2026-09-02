-- Автозадачи журнала РК: чьё это решение и что предлагал алгоритм.
--
-- Панель начинает заполнять задачи сама после ночного сбора (правила —
-- lib/wb/rkAutoTask.ts, выведены из рабочей таблицы «Показы CTR CPC»).
-- Человек после этого правит их руками, и вот это самое ценное: расхождение
-- между советом и правкой — единственный материал, по которому алгоритм можно
-- чинить. Поэтому предложение НЕ затирается правкой, а остаётся рядом.
--
--   source          'auto'  — строку завёл алгоритм и человек её не трогал;
--                   'human' — последнее слово за человеком (он написал или
--                             переписал задачу).
--   suggested_note  что предлагал алгоритм. Живёт даже после правки — иначе
--                   узнать, с чем именно человек не согласился, будет нечем.
--   suggested_reason почему предлагал: показывается рядом и объясняет совет.
--   suggested_at    когда предложил.
--
-- Метрика качества считается по этим полям одним запросом: доля строк, где
-- source='human' и note <> suggested_note, — это доля отвергнутых советов.
-- Если она выше половины, чинить надо правило, а не уговаривать людей.

alter table public.wb_rk_notes
  add column if not exists source text not null default 'human',
  add column if not exists suggested_note text,
  add column if not exists suggested_reason text,
  add column if not exists suggested_at timestamptz;

do $$ begin
  alter table public.wb_rk_notes
    add constraint wb_rk_notes_source_check check (source in ('auto', 'human'));
exception when duplicate_object then null; end $$;

comment on column public.wb_rk_notes.source is
  'Кто оставил задачу: auto — алгоритм, human — человек (в том числе переписавший совет).';
comment on column public.wb_rk_notes.suggested_note is
  'Что предлагал алгоритм. Не затирается правкой человека: расхождение — материал для дообучения.';
comment on column public.wb_rk_notes.suggested_reason is
  'Почему алгоритм это предложил — показывается рядом с задачей.';

-- Разбор расхождений читает только автозаполненные строки за окно.
create index if not exists wb_rk_notes_source_idx
  on public.wb_rk_notes (cabinet_id, date)
  where suggested_note is not null;
