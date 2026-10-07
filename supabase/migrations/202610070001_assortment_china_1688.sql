-- «Разработка ассортимента», движок тенденций — «Китай (1688)» (решение владельца 07.10.2026: официальные ИИ-навыки 1688,
-- ключ ALI_1688_AK выдан на clawhub.1688.com).
--
-- Еженедельный снимок (крон /api/sync/assortment-china, неделя — с понедельника по Москве, observed_on = понедельник):
--   * топ каждой ниши (find.product, по продажам, до 40 карточек, только женское, без платных размещений);
--   * копии по номерам товаров Zara и Uniqlo из рилсов «Залетает» (один поиск на номер, считаются карточки с номером в названии);
--   * тренды ключей ниш (shopkeeper offer_hot) и «возможности» 1688 / Taobao / Xiaohongshu по нашим категориям.
--
-- Что это за числа: счётчик продаж 1688 (sold_text, sold_min) — ФАКТ 1688, накопленный и округлённый «корзинами» — нижняя граница;
-- orders_30d — оплаченные заказы за 30 дней, ФАКТ 1688; is_new — ОЦЕНКА по номеру карточки (номера растут со временем); значок
-- claims_new в tags — ГИПОТЕЗА (заявление продавца «新款» в названии); копии по номеру — ОЦЕНКА, нижняя граница (поиск смысловой,
-- полнота 6–8% от страницы 1688); тренды — ФАКТ и РАСЧЁТ 1688 с отставанием 5–6 недель; «возможности» — ГИПОТЕЗА.
--
-- ЦЕН НЕТ: в ответах 1688 они есть почти везде — разбор берёт поля по белому списку, цены не читаются и сюда не попадают.
-- ПРОДАВЦОВ НЕТ: ни имён магазинов (у ИП это имя человека), ни их id — только ЧИСЛО разных продавцов (sellers). Людей не храним.
-- Оговорка: в адресе фото 1688 (image_url, «…_!!<цифры>-0-cib.jpg») зашит числовой id загрузившего; храним его только у последнего
-- снимка ниши (он показывается на экране): записан снимок новой недели — прогон стирает image_url у прошлых снимков этой ниши, так что по
-- сохранённым строкам не связать карточки одного продавца между неделями. У копий по номеру фото не храним вовсе — только номера карточек.
--
-- Рекомендация ≠ решение о закупке: таблицы только считают и показывают. Только добавление трёх новых таблиц; ничего существующего не
-- меняет. Запросы к 1688 (0 $) и перевод названий на русский (Polza) пишутся в существующий assortment_ai_usage
-- (kind = 'cn_1688' и 'cn_translate'), состояние недельного снимка — в capabilities источника S104 (1688).

-- Топ ниши: строка на карточку в недельном снимке.
create table if not exists public.assortment_cn_offer_snapshot (
  provider    text not null default '1688' check (provider in ('1688')),
  niche_key   text not null check (niche_key ~ '^[a-z0-9_]{2,40}$'),
  direction   text not null check (direction in ('jackets', 'bags')),
  observed_on date not null,
  -- Позиция в выдаче 1688 (по продажам), с 1.
  rank        integer not null check (rank > 0),
  offer_id    text not null check (offer_id ~ '^[0-9]{6,16}$'),
  title_zh    text not null check (char_length(title_zh) <= 200),
  -- Перевод ИИ (Polza); нет ключа или потолок движка выбран — null, экран показывает китайское название.
  title_ru    text check (title_ru is null or char_length(title_ru) <= 200),
  image_url   text check (image_url is null or image_url ~ '^https://[a-z0-9.-]*alicdn\.com/'),
  -- Листовая категория 1688 (cate_id).
  category    text check (category is null or char_length(category) <= 120),
  sold_text   text check (sold_text is null or char_length(sold_text) <= 20),
  sold_min    integer check (sold_min is null or sold_min >= 0),
  orders_30d  integer check (orders_30d is null or orders_30d >= 0),
  -- Разных продавцов во всём топе ниши в этот день (одно число на нишу и день; самих продавцов нет).
  sellers     integer check (sellers is null or sellers >= 0),
  is_new      boolean not null default false,
  -- Значки (yx — подборка «严选», inspected — проверка 1688, claims_new, unisex) и свойства из карточки (cpv:…).
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  primary key (niche_key, observed_on, offer_id)
);

create index if not exists assortment_cn_offer_snapshot_direction_idx
  on public.assortment_cn_offer_snapshot (direction, observed_on desc);

create index if not exists assortment_cn_offer_snapshot_offer_idx
  on public.assortment_cn_offer_snapshot (offer_id, observed_on desc);

-- Копии по номеру товара бренда: строка на номер в недельном снимке.
create table if not exists public.assortment_cn_article_snapshot (
  ref_key          text not null check (ref_key ~ '^(zara:[0-9]{7}|uniqlo:[0-9]{6})$'),
  observed_on      date not null,
  direction        text check (direction is null or direction in ('jackets', 'bags')),
  -- Карточек с номером в названии среди найденных (до 40) и разных продавцов среди них — нижняя граница, оценка.
  offers           integer not null default 0 check (offers >= 0),
  sellers          integer not null default 0 check (sellers >= 0),
  sample_offer_ids text[] not null default '{}',
  created_at       timestamptz not null default now(),
  primary key (ref_key, observed_on)
);

-- Тренды и горячие списки: market:<ниша> — одна строка с рядом покупателей по месяцам (value_text — JSON без цен),
-- opportunity:<площадка>:<trend|hot> — темы по нашим категориям (value_text — JSON: count, isUp, поисковые слова и рост поиска).
create table if not exists public.assortment_cn_trend_snapshot (
  provider    text not null default '1688' check (provider in ('1688')),
  list_key    text not null check (char_length(list_key) <= 80),
  observed_on date not null,
  rank        integer not null check (rank > 0),
  keyword_zh  text not null check (char_length(keyword_zh) <= 80),
  keyword_ru  text check (keyword_ru is null or char_length(keyword_ru) <= 200),
  value_text  text check (value_text is null or char_length(value_text) <= 4000),
  direction   text check (direction is null or direction in ('jackets', 'bags')),
  created_at  timestamptz not null default now(),
  primary key (list_key, observed_on, rank)
);

create index if not exists assortment_cn_trend_snapshot_direction_idx
  on public.assortment_cn_trend_snapshot (direction, observed_on desc);

alter table public.assortment_cn_offer_snapshot enable row level security;
revoke all on public.assortment_cn_offer_snapshot from anon, authenticated;

alter table public.assortment_cn_article_snapshot enable row level security;
revoke all on public.assortment_cn_article_snapshot from anon, authenticated;

alter table public.assortment_cn_trend_snapshot enable row level security;
revoke all on public.assortment_cn_trend_snapshot from anon, authenticated;

notify pgrst, 'reload schema';
