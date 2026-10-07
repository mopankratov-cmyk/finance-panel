-- «Разработка ассортимента» → «Сумки» → «Фабрики (1688)», фаза 1 (решения владельца 07.10.2026: раздел только в «Сумках» — сумки
-- CLÉRIN закупаются в Китае; работает закупщик (buyer) и директор; на карточках фабрик — цены и минимальная партия).
--
-- Две новые таблицы, ничего существующего не меняется:
--   * assortment_cn_factory_search — кэш поиска фабрик на 7 дней (повтор того же запроса — из кэша, без запросов к 1688). В кэше —
--     разобранная выдача: показатели и цены карточек; название фабрики — только у юрлиц (有限公司), у ИП (个体工商户) и неясных —
--     псевдоним «Фабрика N» и ссылка. Кэшируется (под ключом запроса) только полная выдача — оба источника ответили. Строки старше 7 дней
--     стираются в начале каждого поиска и при открытии вкладки.
--   * assortment_cn_factory — шорт-лист: ТОЛЬКО то, что человек сам отправил кнопкой «В шорт-лист». У юрлица — название, ссылка и
--     кредитный код (если проверяли в 88查), у ИП — псевдоним и ссылка. Снимок показателей и цен на дату добавления, статус с историей
--     (кто и когда), ручной чек-лист (пункты раздельно, без суммы), заметка, последняя проверка в реестре (без имён и текстов дел).
--
-- НИКОГДА не храним: имя директора / законного представителя (legal_name из 88查), телефоны, WeChat, логины, тексты дел (contentChinese),
-- адрес дальше района. Общего балла фабрики нет — ни в данных, ни в API. Рекомендация ≠ решение о закупке: статусы ставит только человек.
-- Запросы к 1688 (0 $) пишутся в существующий assortment_ai_usage (kind = 'cn_1688_factory'), перевод запроса — kind = 'cn_translate'.

create table if not exists public.assortment_cn_factory_search (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null default 'bags' check (direction = 'bags'),
  -- sha256 нормализованного китайского запроса (с дописанным кластером).
  query_key   text not null check (query_key ~ '^[0-9a-f]{64}$'),
  query_zh    text not null check (char_length(query_zh) between 1 and 80),
  query_ru    text check (query_ru is null or char_length(query_ru) <= 200),
  cluster_key text check (cluster_key is null or cluster_key ~ '^[a-z]{2,20}$'),
  -- Разобранная выдача (карточки фабрик и продавцов, состояние источников) — без legal_name, телефонов и WeChat.
  result      jsonb not null,
  calls       integer not null default 0 check (calls >= 0),
  created_by  text check (created_by is null or char_length(created_by) <= 200),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days 1 minute')
);

create index if not exists assortment_cn_factory_search_key_idx
  on public.assortment_cn_factory_search (query_key, expires_at desc);

create index if not exists assortment_cn_factory_search_expires_idx
  on public.assortment_cn_factory_search (expires_at);

create table if not exists public.assortment_cn_factory (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null default 'bags' check (direction = 'bags'),
  -- Один и тот же для всех поисков: name:<нормализованное название юрлица> | ps:<HMAC-SHA256 нормализованного названия ИП / неясного
  -- продавца> — псевдоним: имя не хранится, а продавец узнаётся в следующих поисках. Ссылка на магазин — отдельно (shop_url).
  factory_key    text not null unique check (char_length(factory_key) between 5 and 420),
  entity         text not null check (entity in ('company', 'individual', 'unknown')),
  company_name   text check (company_name is null or (entity = 'company' and char_length(company_name) <= 120)),
  -- «Фабрика N» уникальна (индекс ниже): два одновременных «В шорт-лист» не получат один номер.
  pseudonym      text check (pseudonym is null or pseudonym ~ '^Фабрика [0-9]{1,5}$'),
  shop_url       text check (shop_url is null or shop_url ~ '^https://([a-z0-9-]+\.)*1688\.com(/|$)'),
  credit_code    text check (credit_code is null or (entity = 'company' and credit_code ~ '^[0-9A-Z]{18}$')),
  province       text check (province is null or char_length(province) <= 20),
  city           text check (city is null or char_length(city) <= 20),
  cluster_key    text check (cluster_key is null or cluster_key ~ '^[a-z]{2,20}$'),
  offer_ids      text[] not null default '{}',
  query_zh       text check (query_zh is null or char_length(query_zh) <= 80),
  -- Показатели, флаги, цены и минимальная партия на дату добавления — как их видел человек.
  snapshot       jsonb not null,
  snapshot_on    date not null,
  status         text not null default 'candidate'
                 check (status in ('candidate', 'contacted', 'video_call', 'sample_ordered', 'sample_received', 'approved', 'rejected')),
  reject_reason  text check (reject_reason is null or char_length(reject_reason) <= 500),
  -- [{status, reason, by, at}] — только добавление.
  status_history jsonb not null default '[]'::jsonb,
  -- {ключ: {value, by, at}} — ручные отметки по пунктам, без суммы.
  checklist      jsonb not null default '{}'::jsonb,
  note           text check (note is null or char_length(note) <= 2000),
  -- Последняя проверка в 88查: статус, возраст, тип, капитал, риски по типам — без имён и текстов дел.
  registry       jsonb,
  created_by     text check (created_by is null or char_length(created_by) <= 200),
  created_at     timestamptz not null default now(),
  updated_by     text check (updated_by is null or char_length(updated_by) <= 200),
  updated_at     timestamptz not null default now(),
  check ((entity = 'company' and company_name is not null) or (entity <> 'company' and company_name is null and pseudonym is not null)),
  check (status <> 'rejected' or reject_reason is not null)
);

create index if not exists assortment_cn_factory_status_idx
  on public.assortment_cn_factory (status, updated_at desc);

create unique index if not exists assortment_cn_factory_pseudonym_uidx
  on public.assortment_cn_factory (pseudonym) where pseudonym is not null;

alter table public.assortment_cn_factory_search enable row level security;
revoke all on public.assortment_cn_factory_search from anon, authenticated;

alter table public.assortment_cn_factory enable row level security;
revoke all on public.assortment_cn_factory from anon, authenticated;

notify pgrst, 'reload schema';
