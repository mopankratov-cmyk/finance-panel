-- Движок тенденций, этап 2: признаки каталога по фото.
--
-- Признаки по фото сейчас есть только у находок (assortment_references, ~десятки),
-- у ~3 тысяч моделей каталога — нет. Форма по названию (вкладка «Формы») — один
-- признак; длина, объём, воротник, застёжка и т. д. названием не называются.
-- Здесь — оценка ИИ по фото модели каталога (одна запись на модель), и учёт
-- расхода на ИИ, чтобы бюджет движка (до $30 в неделю) контролировался, а не
-- предполагался.
--
-- Это ОЦЕНКА ИИ, не факт сайта и не ручное подтверждение: так и подписывается.
-- Только добавление, ничего существующего не меняет.

-- Оценка по модели: ключ — тот же, что склеивает расцветки в каталоге (model_key).
create table if not exists public.assortment_model_attributes (
  source_id text not null references public.assortment_sources(source_id) on delete cascade,
  model_key text not null,
  direction text not null check (direction in ('jackets', 'bags')),
  -- 'ok' — признаки получены; 'failed' — не вышло (фото не скачалось, ответ не разобрался).
  status text not null check (status in ('ok', 'failed')),
  -- {признак: {"v": "до бедра" | null, "nv": true (не видно), "c": 0..1}} — только поля раздела.
  attributes jsonb,
  -- Какое фото модели разобрано (ссылка на карточку головы модели на момент разбора).
  source_item_id text,
  image_count integer,
  -- Версия вопроса к ИИ и словаря признаков: при смене версии модели можно разобрать заново.
  prompt_version text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10, 5),
  attempts integer not null default 1,
  last_error text,
  taken_at timestamptz not null default now(),
  primary key (source_id, model_key)
);

create index if not exists assortment_model_attributes_direction_idx
  on public.assortment_model_attributes (direction, status);

alter table public.assortment_model_attributes enable row level security;
revoke all on public.assortment_model_attributes from anon, authenticated;

-- Расход на ИИ по дням и назначениям. Пишет только сборщик; бюджет недели —
-- сумма cost_usd за последние 7 дней.
create table if not exists public.assortment_ai_usage (
  day date not null,
  kind text not null,
  calls integer not null default 0,
  failed_calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, kind)
);

alter table public.assortment_ai_usage enable row level security;
revoke all on public.assortment_ai_usage from anon, authenticated;
