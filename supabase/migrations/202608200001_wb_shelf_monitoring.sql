-- Раздел «Полки»: мониторинг цен конкурентов из блока «Смотрите также» (WB).
-- Снимки присылает внешний сборщик (Playwright на Mac владельца) — панель только
-- принимает, хранит и считает срезы. Сырые строки храним ВСЕ, включая исключённые
-- по бренду: флаг исключения и срезы Топ-N считаются при чтении по текущему списку
-- исключений, поэтому правка списка честно перекрашивает и историю.

create table if not exists wb_shelf_watch (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references wb_cabinets(id) on delete cascade,
  nm_id bigint not null,
  supplier_article text,
  -- Бренд/ссылка/фото заполняются автоматически при первом снимке и дальше не
  -- перезаписываются (как у автора наработок: ensureArticleMeta).
  our_brand text,
  our_link text,
  our_img text,
  extra_excluded_brands text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cabinet_id, nm_id)
);

-- Глобальные бренды-исключения кабинета: применяются ко всем отслеживаемым
-- артикулам кабинета поверх авто-исключения собственного бренда.
create table if not exists wb_shelf_cabinet_settings (
  cabinet_id uuid primary key references wb_cabinets(id) on delete cascade,
  global_excluded_brands text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists wb_shelf_snapshots (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references wb_shelf_watch(id) on delete cascade,
  cabinet_id uuid not null,
  nm_id bigint not null,
  collected_at timestamptz not null,
  session_kind text not null default 'guest',
  region text not null default 'Москва',
  -- Цена может быть не снята (вёрстка WB поменялась) — это NULL, не ноль.
  our_price numeric,
  our_brand text,
  our_img text,
  competitor_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (watch_id, collected_at)
);
create index if not exists wb_shelf_snapshots_watch_time
  on wb_shelf_snapshots (watch_id, collected_at desc);

create table if not exists wb_shelf_snapshot_rows (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references wb_shelf_snapshots(id) on delete cascade,
  position integer not null,
  nm_id bigint,
  brand text,
  price numeric,
  img text
);
create index if not exists wb_shelf_snapshot_rows_snapshot
  on wb_shelf_snapshot_rows (snapshot_id);
