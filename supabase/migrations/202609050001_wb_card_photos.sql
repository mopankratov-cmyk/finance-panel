-- Галерея карточки WB перестаёт выбрасываться.
--
-- Обход Content API (lib/wb/cards.ts) по каждой карточке уже собирает `photos`
-- (миниатюры 246×328) и `photosBig` (hq), считает их число и знает про видео —
-- а запись в wb_cards кладёт только nm_id, артикул, имя, бренд и предмет.
-- Галерея вычислялась и терялась на каждом обходе.
--
-- Из-за этого панель знала по товару ровно одну картинку: обложку, собранную
-- из nm_id по таблице баскетов (lib/wb/cardImage.ts), и только первый кадр —
-- `1.webp`. Мастер CTR-теста поэтому и требует вставлять HTTPS-ссылку руками
-- на каждый вариант, кроме первого: выбрать не из чего.
--
-- Колонки складывают то, что уже приезжает, а не заводят новый источник:
-- обход не становится тяжелее ни на один запрос к WB.
alter table public.wb_cards
  add column if not exists photos       jsonb,
  add column if not exists photos_big   jsonb,
  add column if not exists photos_count integer,
  add column if not exists has_video    boolean;

comment on column public.wb_cards.photos is
  'Миниатюры карточки 246×328 в порядке WB: [0] — обложка. Для сеток и предпросмотра.';
comment on column public.wb_cards.photos_big is
  'Те же кадры в hq. Это то, что уходит наружу: варианты CTR-тестов, генерации.';
comment on column public.wb_cards.photos_count is
  'Сколько кадров на карточке. Отдельной колонкой, чтобы «мало фото» искалось без разбора jsonb.';

notify pgrst, 'reload schema';
