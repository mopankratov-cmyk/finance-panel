-- Модуль «Разработка ассортимента», этап 1: схема данных.
-- ТЗ: docs/tz/assortment-development-tz-v3.md; карта интеграции:
-- docs/assortment-development-integration.md §5.
--
-- Границы ТЗ v3: в модуле НЕТ цен, валют, себестоимости, маржи, СПП, бюджетов
-- и MOQ — ни одной такой колонки ниже нет и добавлять их нельзя (тест
-- tests/assortment-development.test.mts проверяет этот файл).
-- История наблюдений и решений только дополняется. Повторная загрузка не
-- создаёт дублей: ключ референса — dedup_key (источник|регион|ID или
-- нормализованный URL), его считает приложение.
-- Только таблицы и данные, без plpgsql: веб-редактор Supabase применяет такой
-- файл одним запуском. Очередь заданий сборщика — отдельной миграцией этапа 2.

create table if not exists public.assortment_sources (
  source_id        text primary key check (source_id ~ '^S[0-9]{3,}$'),
  name             text not null,
  source_group     text,
  categories       text[] not null default '{}',
  region           text,
  priority         text check (priority in ('P0', 'P1', 'P2')),
  adapter_type     text,
  -- Доступ по факту проверки, а не по исследованию.
  access_status    text not null default 'untested'
                   check (access_status in ('auto_verified', 'partial', 'manual_only', 'untested', 'unavailable', 'disabled')),
  research_status  text,
  access_note      text,
  -- discovery / item_details / images / videos / public_metrics /
  -- historical_metrics / export → supported | unsupported | untested.
  capabilities     jsonb not null default '{}'::jsonb,
  seed_urls        text[] not null default '{}',
  docs_url         text,
  last_success_at  timestamptz,
  parser_version   text,
  updated_at       timestamptz not null default now()
);

create table if not exists public.assortment_references (
  id               uuid primary key default gen_random_uuid(),
  direction        text not null check (direction in ('jackets', 'bags')),
  source_id        text references public.assortment_sources(source_id),
  region           text not null default '',
  source_item_id   text,
  url              text not null,
  dedup_key        text not null unique,
  article          text,
  title            text,
  brand            text,
  -- Признак → {value, origin: published | ai_estimate | manual | unknown,
  -- evidence_id, confidence, reviewer, reviewed_at}.
  attributes       jsonb not null default '{}'::jsonb,
  status           text not null default 'new'
                   check (status in ('new', 'watching', 'in_collection', 'selected', 'sample_needed', 'rejected', 'archived')),
  first_seen_at    timestamptz not null default now(),
  published_at     timestamptz,
  last_seen_at     timestamptz not null default now(),
  version          integer not null default 1,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists assortment_references_feed_idx
  on public.assortment_references (direction, status, first_seen_at desc);

create table if not exists public.assortment_media (
  id               uuid primary key default gen_random_uuid(),
  reference_id     uuid not null references public.assortment_references(id) on delete cascade,
  kind             text not null default 'image' check (kind in ('image', 'video_frame', 'screenshot')),
  position         integer not null default 0,
  storage_path     text,
  origin_url       text,
  sha256           text,
  phash            text,
  width            integer,
  height           integer,
  is_manual        boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index if not exists assortment_media_reference_sha_idx
  on public.assortment_media (reference_id, sha256) where sha256 is not null;

-- Наблюдения и доказательства. Значения нет — null и причина, а не ноль.
create table if not exists public.assortment_observations (
  id               uuid primary key default gen_random_uuid(),
  reference_id     uuid references public.assortment_references(id) on delete cascade,
  group_kind       text not null check (group_kind in ('novelty', 'spread', 'retail')),
  metric           text not null,
  value_text       text,
  value_num        numeric,
  unit             text,
  period           text,
  region           text,
  null_reason      text,
  method           text not null,
  status           text not null check (status in ('observed', 'retailer_claim', 'provider_estimate', 'forecast', 'manual')),
  source_url       text,
  observed_at      timestamptz not null,
  collected_at     timestamptz not null default now(),
  created_by       text,
  check (value_text is not null or value_num is not null or null_reason is not null)
);
create index if not exists assortment_observations_reference_idx
  on public.assortment_observations (reference_id, observed_at desc);

create table if not exists public.assortment_collections (
  id               uuid primary key default gen_random_uuid(),
  direction        text not null check (direction in ('jackets', 'bags')),
  kind             text not null check (kind in ('bags_month', 'jackets_season', 'custom')),
  title            text not null,
  period           text,
  status           text not null default 'draft' check (status in ('draft', 'saved', 'archived')),
  version          integer not null default 1,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.assortment_collection_items (
  id               uuid primary key default gen_random_uuid(),
  collection_id    uuid not null references public.assortment_collections(id) on delete cascade,
  reference_id     uuid not null references public.assortment_references(id),
  slot             integer,
  is_reserve       boolean not null default false,
  idea             text,
  details          text[] not null default '{}',
  next_step        text,
  replace_reason   text check (replace_reason in ('repeats_assortment', 'shape', 'audience', 'weak_evidence')),
  created_at       timestamptz not null default now(),
  unique (collection_id, reference_id)
);

-- Решения людей: каждая запись — новая версия, старые не переписываются.
create table if not exists public.assortment_decisions (
  id               uuid primary key default gen_random_uuid(),
  reference_id     uuid references public.assortment_references(id) on delete cascade,
  collection_id    uuid references public.assortment_collections(id) on delete cascade,
  decision         text not null check (decision in ('to_collection', 'selected', 'sample_needed', 'postponed', 'rejected', 'archived')),
  reason           text,
  version          integer not null,
  brief            jsonb,
  author           text,
  created_at       timestamptz not null default now(),
  check (reference_id is not null or collection_id is not null)
);

alter table public.assortment_sources enable row level security;
alter table public.assortment_references enable row level security;
alter table public.assortment_media enable row level security;
alter table public.assortment_observations enable row level security;
alter table public.assortment_collections enable row level security;
alter table public.assortment_collection_items enable row level security;
alter table public.assortment_decisions enable row level security;

revoke all on public.assortment_sources, public.assortment_references, public.assortment_media,
  public.assortment_observations, public.assortment_collections, public.assortment_collection_items,
  public.assortment_decisions from anon, authenticated;

-- Паспорт источников S001–S127 из приложения к ТЗ. access_status — по пробам
-- этапа 0 (01.10.2026), остальные «untested». Повторный запуск обновляет
-- описание, но не затирает access_status, access_note, last_success_at и
-- capabilities: после первого запуска их ведёт приложение.
insert into public.assortment_sources
  (source_id, name, source_group, categories, region, priority, adapter_type, access_status, research_status, access_note, seed_urls, docs_url)
values
  ('S001', 'Zara', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'partial', 'Страница проверена; сборщик не тестировался', 'только sitemap картинок: артикул, url, фото; нет пола и метки новинки', array['https://www.zara.com/uk/en/woman-jackets-l1114.html']::text[], null),
  ('S002', 'Mango', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'manual_only', 'Страница проверена; сборщик не тестировался', '429 Vercel Security Checkpoint; кандидат на платный провайдер или фид CJ', array['https://shop.mango.com/gb/en/c/women/bags/8dff98e6/']::text[], null),
  ('S003', 'Uniqlo', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'manual_only', 'Страница проверена; сборщик не тестировался', '403 Akamai; кандидат на платный провайдер или фид Awin', array['https://www.uniqlo.com/uk/en/spl/ranking/women']::text[], null),
  ('S004', 'GU', 'Массовые бренды', array['jackets','bags']::text[], 'Япония', 'P1', 'C1 Каталоги', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.gu-global.com/jp/ja/']::text[], null),
  ('S005', 'COS', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'manual_only', 'Открыт выбор региона; карточки не тестировались', '403 Akamai', array['https://www.cos.com/']::text[], null),
  ('S006', 'ARKET', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Страница не прочиталась; нужен пилот', null, array['https://www.arket.com/']::text[], null),
  ('S007', 'H&M', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www2.hm.com/']::text[], null),
  ('S008', 'Massimo Dutti', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'manual_only', 'Страница проверена; сборщик не тестировался', 'проверка на бота Akamai', array['https://www.massimodutti.com/']::text[], null),
  ('S009', '& Other Stories', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.stories.com/']::text[], null),
  ('S010', 'Bershka', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.bershka.com/']::text[], null),
  ('S011', 'Pull&Bear', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.pullandbear.com/']::text[], null),
  ('S012', 'Stradivarius', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.stradivarius.com/']::text[], null),
  ('S013', 'Reserved', 'Массовые бренды', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.reserved.com/']::text[], null),
  ('S014', 'Rains', 'Верхняя одежда', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'auto_verified', 'Страница проверена; сборщик не тестировался', 'Shopify products.json; коллекции women, new-arrivals', array['https://rains.com/']::text[], null),
  ('S015', 'Barbour', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.barbour.com/']::text[], null),
  ('S016', 'K-Way', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.k-way.com/']::text[], null),
  ('S017', 'The North Face', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.thenorthface.com/']::text[], null),
  ('S018', 'Arc’teryx', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://arcteryx.com/']::text[], null),
  ('S019', 'Patagonia', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.patagonia.com/']::text[], null),
  ('S020', 'Columbia', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.columbia.com/']::text[], null),
  ('S021', 'Save The Duck', 'Верхняя одежда', array['jackets']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.savetheduck.com/']::text[], null),
  ('S022', 'Bosideng', 'Верхняя одежда', array['jackets']::text[], 'Китай', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.bosideng.com/']::text[], null),
  ('S023', 'Snow Peak', 'Верхняя одежда', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.snowpeak.com/']::text[], null),
  ('S024', 'Polène', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'auto_verified', 'Страница проверена; сборщик не тестировался', 'Shopify products.json; коллекции handbags, new-bags; тег NEW', array['https://eng.polene-paris.com/']::text[], null),
  ('S025', 'DeMellier', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'disabled', 'Страница проверена; сборщик не тестировался', 'robots.txt запрещает автоматический сбор', array['https://demellierlondon.com/']::text[], null),
  ('S026', 'Songmont', 'Бренды сумок', array['bags']::text[], 'Китай / global-витрина', 'P0', 'C1 Каталоги', 'auto_verified', 'Страница проверена; сборщик не тестировался', 'Shopify products.json (songmontofficial.com); коллекции all-bags, new-arrivals', array['https://songmontofficial.com/']::text[], null),
  ('S027', 'JW PEI', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'auto_verified', 'Страница проверена; сборщик не тестировался', 'Shopify products.json; коллекции coats-jackets, bags, topnew-in-bags', array['https://www.jwpei.com/']::text[], null),
  ('S028', 'Charles & Keith', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P0', 'C1 Каталоги', 'auto_verified', 'Страница проверена; сборщик не тестировался', 'HTML /us/, атрибут data-ga, пауза 10 с; цена отбрасывается', array['https://www.charleskeith.com/']::text[], null),
  ('S029', 'Coach', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.coach.com/']::text[], null),
  ('S030', 'Longchamp', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.longchamp.com/']::text[], null),
  ('S031', 'Furla', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.furla.com/']::text[], null),
  ('S032', 'Coccinelle', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.coccinelle.com/']::text[], null),
  ('S033', 'Stand Oil', 'Бренды сумок', array['bags']::text[], 'Корея / global-витрина', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://standoil.kr/']::text[], null),
  ('S034', 'Marge Sherwood', 'Бренды сумок', array['bags']::text[], 'Корея / global-витрина', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://margesherwood.com/']::text[], null),
  ('S035', 'OSOI', 'Бренды сумок', array['bags']::text[], 'Корея / global-витрина', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://osoi.co.kr/']::text[], null),
  ('S036', 'Aesther Ekme', 'Бренды сумок', array['bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://aestherekme.com/']::text[], null),
  ('S037', 'Loewe', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.loewe.com/']::text[], null),
  ('S038', 'Prada', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.prada.com/']::text[], null),
  ('S039', 'Miu Miu', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.miumiu.com/']::text[], null),
  ('S040', 'Bottega Veneta', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.bottegaveneta.com/']::text[], null),
  ('S041', 'Celine', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.celine.com/']::text[], null),
  ('S042', 'Jacquemus', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.jacquemus.com/']::text[], null),
  ('S043', 'Toteme', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://toteme.com/']::text[], null),
  ('S044', 'Ganni', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.ganni.com/']::text[], null),
  ('S045', 'Acne Studios', 'Дизайнерские референсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.acnestudios.com/']::text[], null),
  ('S046', 'ASOS', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.asos.com/']::text[], null),
  ('S047', 'Zalando', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.zalando.com/']::text[], null),
  ('S048', 'ABOUT YOU', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.aboutyou.com/']::text[], null),
  ('S049', 'Nordstrom', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.nordstrom.com/']::text[], null),
  ('S050', 'Revolve', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.revolve.com/']::text[], null),
  ('S051', 'Shopbop', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.shopbop.com/']::text[], null),
  ('S052', 'NET-A-PORTER', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.net-a-porter.com/']::text[], null),
  ('S053', 'Farfetch', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.farfetch.com/']::text[], null),
  ('S054', 'SSENSE', 'Мультибрендовые магазины', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.ssense.com/']::text[], null),
  ('S055', 'MUSINSA', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Корея / отдельная global-витрина', 'P0', 'C1 Каталоги', 'untested', 'Открыт выбор региона; нужен пилот', null, array['https://global.musinsa.com/']::text[], null),
  ('S056', '29CM', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Корея', 'P0', 'C1 Каталоги', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.29cm.co.kr/']::text[], null),
  ('S057', 'W Concept', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Корея / США', 'P1', 'C1 Каталоги', 'untested', 'Страница не прочиталась; нужен пилот', null, array['https://www.wconcept.com/']::text[], null),
  ('S058', 'ZOZOTOWN', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Япония', 'P1', 'C1 Каталоги', 'untested', 'Страница не прочиталась; нужен пилот', null, array['https://zozo.jp/ranking/']::text[], null),
  ('S059', 'Rakuten Ichiba', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Япония', 'P0', 'A3 Rakuten', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://www.rakuten.co.jp/']::text[], 'https://webservice.rakuten.co.jp/documentation/ichiba-item-ranking'),
  ('S060', 'Taobao', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.taobao.com/']::text[], null),
  ('S061', 'Tmall', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.tmall.com/']::text[], null),
  ('S062', 'JD', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.jd.com/']::text[], null),
  ('S063', 'Douyin Shop', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.douyinec.com/']::text[], null),
  ('S064', 'SHEIN', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'ЕС / Великобритания / США', 'P1', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.shein.com/']::text[], null),
  ('S065', 'Amazon Best Sellers', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'США / Великобритания / Германия', 'P1', 'C1 Каталоги', 'untested', 'Описание BSR проверено; витрина не тестировалась', null, array['https://www.amazon.com/Best-Sellers/zgbs']::text[], 'https://sell.amazon.com/blog/amazon-best-sellers-rank'),
  ('S066', 'eBay', 'Азия и маркетплейсы', array['jackets','bags']::text[], 'США / Европа', 'P2', 'A4 eBay', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://www.ebay.com/']::text[], 'https://www.developer.ebay.com/develop/api/buy'),
  ('S067', 'Pinterest Pins', 'Соцсети и образы', array['jackets','bags']::text[], 'Регионы Pinterest', 'P0', 'C2 Social', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.pinterest.com/']::text[], 'https://developers.pinterest.com/'),
  ('S068', 'Instagram Reels', 'Соцсети и образы', array['jackets','bags']::text[], 'Европа / США / Азия', 'P0', 'C2 Social', 'untested', 'Официальная коллекция найдена; операции требуют пилота', null, array['https://www.instagram.com/']::text[], 'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api'),
  ('S069', 'TikTok', 'Соцсети и образы', array['jackets','bags']::text[], 'По доступным регионам', 'P0', 'C2 Social', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://ads.tiktok.com/business/creativecenter/']::text[], 'https://developers.tiktok.com/docs/en/research-api-faq'),
  ('S070', 'YouTube', 'Соцсети и образы', array['jackets','bags']::text[], 'Глобально, с языковыми фильтрами', 'P0', 'A2 YouTube', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://www.youtube.com/']::text[], 'https://developers.google.com/youtube/v3/docs/search/list'),
  ('S071', 'Xiaohongshu / RED', 'Соцсети и образы', array['jackets','bags']::text[], 'Китай', 'P0', 'C4 Китай', 'untested', 'Проверен сайт open-платформы; social-доступ не подтверждён', null, array['https://www.xiaohongshu.com/']::text[], 'https://open.xiaohongshu.com/'),
  ('S072', 'Douyin', 'Соцсети и образы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.douyin.com/']::text[], null),
  ('S073', 'WEAR', 'Соцсети и образы', array['jackets','bags']::text[], 'Япония', 'P0', 'C2 Social', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://wear.jp/']::text[], null),
  ('S074', 'StyleHint', 'Соцсети и образы', array['jackets','bags']::text[], 'Япония / рынки Uniqlo и GU', 'P1', 'C2 Social', 'untested', 'Найдена ссылка на сервис на официальном сайте GU', null, array['https://www.stylehint.com/']::text[], 'https://www.gu-global.com/jp/ja/'),
  ('S075', 'Reddit', 'Соцсети и образы', array['jackets','bags']::text[], 'Англоязычные сообщества', 'P1', 'C2 Social', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://www.reddit.com/r/handbags/']::text[], 'https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data'),
  ('S076', 'PurseForum', 'Соцсети и образы', array['bags']::text[], 'Глобально', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://forum.purseblog.com/']::text[], null),
  ('S077', 'Lemon8', 'Соцсети и образы', array['jackets','bags']::text[], 'По региональным версиям', 'P2', 'C2 Social', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.lemon8-app.com/']::text[], null),
  ('S078', 'LTK', 'Соцсети и образы', array['jackets','bags']::text[], 'США / Европа', 'P1', 'C2 Social', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.shopltk.com/']::text[], null),
  ('S079', 'Google Trends', 'Поисковые тренды', array['jackets','bags']::text[], 'По странам и языкам', 'P0', 'A5 Trends', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://trends.google.com/']::text[], 'https://developers.google.com/search/apis/trends'),
  ('S080', 'Pinterest Trends', 'Поисковые тренды', array['jackets','bags']::text[], 'Поддержанные регионы', 'P0', 'A1 Pinterest', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://trends.pinterest.com/']::text[], 'https://dev.pinterest.com/docs/analytics-and-reports/trends/'),
  ('S081', 'NAVER DataLab', 'Поисковые тренды', array['jackets','bags']::text[], 'Корея', 'P1', 'A6 Naver', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://datalab.naver.com/']::text[], 'https://api.ncloud-docs.com/docs/en/naver-api-hub-shopping-insight-device'),
  ('S082', 'Baidu Index', 'Поисковые тренды', array['jackets','bags']::text[], 'Китай', 'P2', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://index.baidu.com/']::text[], null),
  ('S083', 'Яндекс Wordstat', 'Поисковые тренды', array['jackets','bags']::text[], 'Россия', 'P2', 'A7 Wordstat', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://wordstat.yandex.ru/']::text[], 'https://yandex.cloud/en/docs/search-api/api-ref/grpc/Wordstat/'),
  ('S084', 'Google Lens', 'Визуальный поиск', array['jackets','bags']::text[], 'Глобально', 'P0', 'A8 Visual search', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://lens.google/']::text[], 'https://serpapi.com/google-lens-api'),
  ('S085', 'Tagwalk', 'Подиумы и редакции', array['jackets','bags']::text[], 'Мировые недели моды', 'P0', 'C3 Редакционные', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.tag-walk.com/en/']::text[], 'https://www.tag-walk.com/en/data-products/dashboard'),
  ('S086', 'Vogue Runway', 'Подиумы и редакции', array['jackets','bags']::text[], 'Мировые недели моды', 'P0', 'C3 Редакционные', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.vogue.com/fashion-shows']::text[], null),
  ('S087', 'WWD', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://wwd.com/']::text[], null),
  ('S088', 'Who What Wear', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.whowhatwear.com/']::text[], null),
  ('S089', 'PurseBlog', 'Подиумы и редакции', array['bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.purseblog.com/']::text[], null),
  ('S090', 'NOWFASHION', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://nowfashion.com/']::text[], null),
  ('S091', 'Vogue Street Style', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.vogue.com/fashion/street-style']::text[], null),
  ('S092', 'Highsnobiety', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.highsnobiety.com/']::text[], null),
  ('S093', 'Hypebeast', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://hypebeast.com/']::text[], null),
  ('S094', 'FashionUnited', 'Подиумы и редакции', array['jackets','bags']::text[], 'Международные редакции', 'P1', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://fashionunited.com/']::text[], null),
  ('S095', 'Lyst Index', 'Подиумы и редакции', array['jackets','bags']::text[], 'Аудитория Lyst', 'P1', 'C3 Редакционные', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.lyst.com/the-lyst-index/']::text[], null),
  ('S096', 'WGSN', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.wgsn.com/en/products/fashion-design']::text[], null),
  ('S097', 'Heuritech', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'A9 Fashion data', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://heuritech.com/heuritech-market-insights/']::text[], 'https://heuritech.com/heuritech-market-insights/'),
  ('S098', 'EDITED', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'A9 Fashion data', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://build.edited.com/']::text[], 'https://build.edited.com/the-data/'),
  ('S099', 'Future Snoops', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.futuresnoops.com/en']::text[], 'https://www.fashionsnoops.com/'),
  ('S100', 'Trendalytics', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://trendalytics.co/']::text[], null),
  ('S101', 'Trendstop', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.trendstop.com/']::text[], null),
  ('S102', 'Stylumia Orbix', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.stylumia.ai/trends']::text[], null),
  ('S103', 'POP Fashion', 'Профессиональная аналитика', array['jackets','bags']::text[], 'Покрытие по договору', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.popfashioninfo.com/trends/?key=Bags']::text[], null),
  ('S104', '1688', 'Фабрики и материалы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.1688.com/']::text[], 'https://open.1688.com/'),
  ('S105', 'Alibaba.com', 'Фабрики и материалы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.alibaba.com/']::text[], null),
  ('S106', 'Made-in-China', 'Фабрики и материалы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.made-in-china.com/']::text[], null),
  ('S107', 'Global Sources', 'Фабрики и материалы', array['jackets','bags']::text[], 'Китай', 'P1', 'C4 Китай', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.globalsources.com/']::text[], null),
  ('S108', 'Première Vision', 'Фабрики и материалы', array['jackets','bags']::text[], 'Европа / Азия', 'P2', 'C3 Редакционные', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.premierevision.com/en']::text[], null),
  ('S109', 'LINEAPELLE', 'Фабрики и материалы', array['bags']::text[], 'Европа / Азия', 'P2', 'C3 Редакционные', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.lineapelle-fair.it/en/']::text[], null),
  ('S110', 'APLF', 'Фабрики и материалы', array['bags']::text[], 'Европа / Азия', 'P2', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.aplf.com/']::text[], null),
  ('S111', 'PERFORMANCE DAYS', 'Фабрики и материалы', array['jackets']::text[], 'Европа / Азия', 'P2', 'C3 Редакционные', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://www.performancedays.com/']::text[], null),
  ('S112', 'ISPO', 'Фабрики и материалы', array['jackets']::text[], 'Европа / Азия', 'P2', 'C3 Редакционные', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.ispo.com/']::text[], null),
  ('S113', 'Vestiaire Collective', 'Вторичный рынок', array['jackets','bags']::text[], 'По региональной витрине', 'P2', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.vestiairecollective.com/']::text[], null),
  ('S114', 'The RealReal', 'Вторичный рынок', array['jackets','bags']::text[], 'По региональной витрине', 'P2', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.therealreal.com/']::text[], null),
  ('S115', 'Depop', 'Вторичный рынок', array['jackets','bags']::text[], 'По региональной витрине', 'P2', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.depop.com/']::text[], null),
  ('S116', 'Vinted', 'Вторичный рынок', array['jackets','bags']::text[], 'По региональной витрине', 'P2', 'C1 Каталоги', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.vinted.com/']::text[], null),
  ('S117', 'FastMoss', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'A10 Commerce social', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://www.fastmoss.com/']::text[], 'https://developers.fastmoss.com/mcp/overview'),
  ('S118', 'Kalodata', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'C5 Лицензия', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.kalodata.com/']::text[], null),
  ('S119', 'Bright Data', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'C2 Social', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://brightdata.com/products/web-scraper/instagram/reels']::text[], 'https://brightdata.com/products/web-scraper/instagram/reels'),
  ('S120', 'Apify', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'C6 Сборщик', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://apify.com/']::text[], 'https://docs.apify.com/api/v2'),
  ('S121', 'SerpApi', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'A8 Visual search', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://serpapi.com/']::text[], 'https://serpapi.com/google-lens-api'),
  ('S122', 'DataForSEO', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'A5 Trends', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://dataforseo.com/']::text[], 'https://dataforseo.com/apis/google-trends-api'),
  ('S123', 'Awin Product Feeds', 'Поставщики данных', array['jackets','bags']::text[], 'Покрытие по продукту', 'P1', 'C7 Фиды', 'untested', 'Документация проверена; ключ не тестировался', null, array['https://www.awin.com/']::text[], 'https://help.awin.com/developers/docs/product-feed-list-download'),
  ('S124', 'QianGua', 'Поставщики данных', array['jackets','bags']::text[], 'Китай', 'P1', 'C5 Лицензия', 'untested', 'Описание сервиса найдено; API не подтверждён', null, array['https://www.qian-gua.com/']::text[], null),
  ('S125', 'Chanmama', 'Поставщики данных', array['jackets','bags']::text[], 'Китай', 'P1', 'C5 Лицензия', 'untested', 'Описание сервиса найдено; API не подтверждён', null, array['https://www.chanmama.com/']::text[], null),
  ('S126', 'Feigua', 'Поставщики данных', array['jackets','bags']::text[], 'Китай', 'P1', 'C5 Лицензия', 'untested', 'Страница проверена; сборщик не тестировался', null, array['https://dy3.feigua.cn/']::text[], null),
  ('S127', 'Newrank', 'Поставщики данных', array['jackets','bags']::text[], 'Китай', 'P1', 'C5 Лицензия', 'untested', 'Кандидат; доступ не проверен', null, array['https://www.newrank.cn/']::text[], null)
on conflict (source_id) do update set
  name = excluded.name,
  source_group = excluded.source_group,
  categories = excluded.categories,
  region = excluded.region,
  priority = excluded.priority,
  adapter_type = excluded.adapter_type,
  research_status = excluded.research_status,
  docs_url = excluded.docs_url,
  updated_at = now();

notify pgrst, 'reload schema';
