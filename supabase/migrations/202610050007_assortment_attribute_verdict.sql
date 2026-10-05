-- «Разработка ассортимента», движок тенденций — измерение точности разбора по фото.
--
-- Признаки каталога по фото — оценка ИИ (assortment_model_attributes). Пока человек не сверил их с картинкой,
-- точность неизвестна: 12 безошибочных примеров допускают ошибку до ~25%. Эта таблица хранит отметки «верно / неверно /
-- не понять» по одному признаку одной модели, чтобы показывать «верно 38 из 45 (84%)» и прятать доли признака, пока
-- нижняя граница точности ниже порога.
--
-- Отметка привязана к версии вопроса к ИИ и модели, по которым получен разбор (берутся из строки разбора на сервере, а не
-- от клиента): после смены вопроса прежние отметки в точность нового не входят. Только добавление новой таблицы,
-- ничего существующего не меняет. Цен здесь нет.

create table if not exists public.assortment_attribute_verdict (
  source_id      text not null,
  model_key      text not null,
  direction      text not null check (direction in ('jackets', 'bags')),
  -- Ключ признака раздела (silhouette, subtype, …).
  field_key      text not null,
  prompt_version text not null,
  -- Какой моделью получен разбор (из строки разбора).
  ai_model       text,
  -- ok — ИИ описал верно; wrong — неверно; unclear — по фото не понять (в точность не входит).
  verdict        text not null check (verdict in ('ok', 'wrong', 'unclear')),
  judged_by      text,
  judged_at      timestamptz not null default now(),
  primary key (source_id, model_key, field_key, prompt_version)
);

create index if not exists assortment_attribute_verdict_direction_idx
  on public.assortment_attribute_verdict (direction, prompt_version);

alter table public.assortment_attribute_verdict enable row level security;
revoke all on public.assortment_attribute_verdict from anon, authenticated;

notify pgrst, 'reload schema';
