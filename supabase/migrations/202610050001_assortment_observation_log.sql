-- «Разработка ассортимента», движок тенденций — этап 1: слой наблюдений.
--
-- Каталог (assortment_source_items) хранит только «как сейчас»: апсёрт
-- перезаписывает строку, истории по датам нет, и пропажа товара при успешной
-- проверке неотличима от сбоя сборщика. Для анализа тенденций нужна история —
-- а её нельзя наверстать задним числом. Эти две таблицы её заводят.
--
-- Образец — история остатков (wb_stocks_history + sync_log): снимок пишет
-- только то, что видел, а «видел ли вообще» и «полный ли был обход» берётся из
-- журнала прогонов. Так «товар пропал» отличается от «сборщик не отработал».
--
-- Обе таблицы — ТОЛЬКО ДОПОЛНЯЮТСЯ (append-only по смыслу): снимок прошлого дня
-- не переписывается. Цен здесь нет и быть не может (граница модуля).

-- Журнал прогонов по источнику и разделу. Одна строка на обход раздела.
create table if not exists public.assortment_run (
  run_id       uuid primary key,
  source_id    text not null references public.assortment_sources(source_id) on delete cascade,
  -- Раздел прогона. NULL — источник обходится целиком (Shopify отдаёт куртки и
  -- сумки одним обходом); тогда раздел несёт каждый снимок.
  direction    text check (direction is null or direction in ('jackets','bags')),
  observed_on  date not null,
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  -- Насколько полно увидели раздел — от этого зависит доверие к «появилось/пропало»:
  --   full    — раздел пройден целиком; отсутствие товара = снят с продажи;
  --   window  — видели только верх выдачи (ASOS по слову, H&M топ-25, упёршаяся
  --             в потолок выборка набора); «новинка» = впервые попало в окно, не факт;
  --   partial — обход оборвался (дедлайн, 404, 0 карточек) — выводов о пропаже не делаем.
  coverage     text not null check (coverage in ('full','window','partial')),
  seen         integer not null default 0,
  added        integer not null default 0,
  -- Номер оплаченной выборки Bright Data (для сверки расхода); иначе NULL.
  snapshot_id  text,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists assortment_run_source_idx
  on public.assortment_run (source_id, direction, observed_on desc);
create index if not exists assortment_run_day_idx
  on public.assortment_run (observed_on desc);

-- Снимок присутствия товара на дату прогона. Пишется только то, что видели
-- (present = true): строки на отсутствующий товар нет, как у истории остатков.
-- «Пропал» = нет снимка за день с полным (coverage = full) прогоном источника.
create table if not exists public.assortment_item_snapshot (
  id             bigint generated always as identity primary key,
  run_id         uuid not null references public.assortment_run(run_id) on delete cascade,
  source_id      text not null,
  source_item_id text not null,
  direction      text check (direction is null or direction in ('jackets','bags')),
  observed_on    date not null,
  present        boolean not null default true,
  title          text,
  brand          text,
  -- Ссылки на фото и метки сайта на дату — для будущего «фото/метка сменились».
  image_urls     jsonb,
  badges         jsonb,
  created_at     timestamptz not null default now(),
  -- Один прогон — один снимок товара: повтор записи прогона не плодит строки.
  unique (source_id, source_item_id, run_id)
);

create index if not exists assortment_item_snapshot_item_idx
  on public.assortment_item_snapshot (source_id, source_item_id, observed_on desc);
create index if not exists assortment_item_snapshot_day_idx
  on public.assortment_item_snapshot (observed_on desc, source_id);

alter table public.assortment_run enable row level security;
alter table public.assortment_item_snapshot enable row level security;
revoke all on public.assortment_run from anon, authenticated;
revoke all on public.assortment_item_snapshot from anon, authenticated;
