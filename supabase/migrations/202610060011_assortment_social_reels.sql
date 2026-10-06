-- «Разработка ассортимента», движок тенденций — «Залетает в соцсетях» (решение владельца 06.10.2026).
--
-- Рилсы Instagram про Zara и Uniqlo, только женское. Сборщик (крон /api/sync/assortment-social, Bright Data Web Unlocker)
-- находит рилсы на страницах тем /popular/, в Google и в профилях наблюдаемых аккаунтов, мерит их 2–21 день от публикации
-- (первый замер, затем на 3-й и 7-й день) и судит по правилу reels-v1 («залетает» — лайки ≥10× медианы автора или
-- комментарии ≥5× с ≥50% вопросов «где купить / цена / ссылка»). «Залетевшие» привязываются к модели каталога по номеру
-- товара из подписи, иначе — к карточке на сайте бренда.
--
-- Что это: лайки, комментарии и просмотры — ФАКТ со страницы Instagram (лайки и просмотры Instagram округляет — оценка);
-- медианы, отношения и вердикт — РАСЧЁТ по правилу; дата публикации — РАСЧЁТ по коду рилса.
--
-- Людей не храним: ни комментаторов, ни подписчиков, ни текстов комментариев — только счётчики (сколько видимых
-- комментариев и сколько из них с намерением купить). Публичные аккаунты авторов рилсов (стилисты, байеры, бренды) владелец
-- разрешил хранить как источники. Картинки Instagram не храним: превью модели — ссылка с сайта бренда или из каталога.
-- Цен здесь нет: из отрывка подписи суммы вырезаются до записи.
--
-- Только добавление двух новых таблиц, ничего существующего не меняет. Расход запросов пишется в существующий
-- assortment_ai_usage (kind = 'brightdata_social'), состояние поиска (темы) — в capabilities источника S068.

-- Аккаунты-источники: стартовые (seed), найденные прогоном (auto) и заведённые вручную (owner).
create table if not exists public.assortment_social_account (
  platform        text not null default 'instagram' check (platform in ('instagram')),
  handle          text not null,
  kind            text not null default 'unknown' check (kind in ('stylist', 'buyer', 'reseller', 'brand', 'blogger', 'unknown')),
  origin          text not null default 'auto' check (origin in ('seed', 'auto', 'owner')),
  -- watched — профиль обходится не реже раза в неделю; seen — встречался в выдаче; excluded — исключён директором (прогон не трогает).
  status          text not null default 'seen' check (status in ('watched', 'seen', 'excluded')),
  note            text,
  -- Подписчиков публичного аккаунта (число, без списков людей) — для запасного правила «лайки ≥ 20% подписчиков».
  followers       integer,
  -- База автора: медианы последних 12 постов по дате (без закреплённых, без свежих младше 48 ч).
  likes_median    numeric(12, 2),
  comments_median numeric(12, 2),
  -- Постов с видимыми лайками в медиане: меньше 6 — вердикт по запасному правилу, «предварительно».
  baseline_posts  integer,
  baseline_at     timestamptz,
  -- Появлений в выдаче (темы и Google) за 30 дней: от двух авто-аккаунт становится наблюдаемым.
  appearances     integer not null default 0,
  first_seen_at   timestamptz not null default now(),
  last_checked_at timestamptz,
  last_error      text,
  primary key (platform, handle)
);

create index if not exists assortment_social_account_status_idx
  on public.assortment_social_account (status, last_checked_at);

-- Рилсы и посты: замеры, вердикт и привязка к модели.
create table if not exists public.assortment_social_post (
  platform            text not null default 'instagram' check (platform in ('instagram')),
  code                text not null,
  url                 text not null,
  account_handle      text,
  published_at        timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_checked_at     timestamptz,
  checks              integer not null default 0,
  -- Где нашли: topic (страница темы), google, profile (профиль наблюдаемого), author (сетка автора при подсчёте базы).
  found_via           text[] not null default '{}',
  topics              text[] not null default '{}',
  brand               text check (brand in ('zara', 'uniqlo')),
  direction           text check (direction in ('jackets', 'bags')),
  -- Отрывок подписи ≤ 500 знаков: без @упоминаний и без сумм.
  caption_excerpt     text check (caption_excerpt is null or char_length(caption_excerpt) <= 500),
  hashtags            text[] not null default '{}',
  -- Номера товаров: «zara:5854722» (модель + качество), «uniqlo:487882».
  refs                text[] not null default '{}',
  likes               integer,
  comments            integer,
  views               integer,
  likes_hidden        boolean,
  -- Видимые комментарии: всего и с намерением купить (без ответов автора и слов-паролей из подписи). Тексты не храним.
  intent_count        integer,
  intent_total        integer,
  likes_ratio         numeric(12, 2),
  comments_ratio      numeric(12, 2),
  verdict             text check (verdict in ('strong', 'viral', 'normal', 'too_fresh', 'too_old')),
  verdict_preliminary boolean not null default false,
  rule_version        text,
  -- Последние замеры (не больше 10): [{at, likes, comments, views}].
  history             jsonb not null default '[]'::jsonb,
  match_status        text check (match_status in ('catalog', 'brand_site', 'men', 'kids', 'not_found', 'no_ref', 'pending')),
  match_model_key     text,
  match_url           text,
  match_title         text,
  -- Ссылка на фото модели с сайта бренда или из каталога (не копия, не Instagram).
  match_image         text,
  match_gender        text check (match_gender in ('women', 'men', 'kids', 'unisex', 'unknown')),
  match_checked_at    timestamptz,
  -- «Не интересен этот рилс» — ручная отметка (экран), прогон её не пишет.
  hidden_at           timestamptz,
  hidden_by           text,
  last_error          text,
  primary key (platform, code)
);

create index if not exists assortment_social_post_verdict_idx
  on public.assortment_social_post (verdict, published_at desc);

create index if not exists assortment_social_post_published_idx
  on public.assortment_social_post (platform, published_at);

create index if not exists assortment_social_post_account_idx
  on public.assortment_social_post (account_handle, published_at desc);

create index if not exists assortment_social_post_refs_idx
  on public.assortment_social_post using gin (refs);

alter table public.assortment_social_account enable row level security;
revoke all on public.assortment_social_account from anon, authenticated;

alter table public.assortment_social_post enable row level security;
revoke all on public.assortment_social_post from anon, authenticated;

notify pgrst, 'reload schema';
