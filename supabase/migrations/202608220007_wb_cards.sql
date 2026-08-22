-- Карточки WB в базе, а не только в кэше Next.
--
-- Бренд и предмет товара нужны фильтрам РНП, но жили исключительно в
-- unstable_cache: снимок, записанный одним роутом, другой роут не находил —
-- ключ этого кэша зависит от текста функции после сборки, а он у разных
-- бандлов разный. Итог на проде: /api/pim отдавал 64 карточки за секунду,
-- а РНП в том же кабинете возвращал pim_cold и пустые «Бренд» и «Категория».
-- Обойти обходом Content API нельзя: на Retail Family он идёт больше минуты.
--
-- Таблица снимает зависимость от кэша: обход пишет сюда, экраны читают
-- отсюда. Данные справочные, поэтому устаревание не страшно — важно, что
-- они есть всегда.
create table if not exists public.wb_cards (
  cabinet_id uuid,
  nm_id      bigint not null,
  imt_id     bigint,
  article    text,
  name       text,
  brand      text,
  subject    text,
  shop       text,
  updated_at timestamptz not null default now()
);

-- cabinet_id бывает null (общий seller-токен): nulls not distinct делает
-- null равным null в ключе, иначе PostgREST-upsert плодил бы дубли.
do $$ begin
  alter table public.wb_cards
    add constraint wb_cards_key unique nulls not distinct (cabinet_id, nm_id);
exception when duplicate_object then null; end $$;

create index if not exists wb_cards_cabinet_idx on public.wb_cards (cabinet_id);

alter table public.wb_cards enable row level security;
revoke all on table public.wb_cards from anon, authenticated;
grant all on table public.wb_cards to service_role;
