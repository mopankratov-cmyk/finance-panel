-- Отслеживание цен конкурентов: ручной список против каждого нашего товара.
--
-- Раздел «Полки» уже собирает конкурентов сам — из блока «Смотрите также».
-- Это другая задача: владелец сам выбирает, с кем сравниваться, и следит за
-- ценой именно этих артикулов. В рабочей таблице владельца это 24 наших
-- товара и 109 связей (96 уникальных артикулов конкурентов), в среднем
-- 4,5 конкурента на товар.
--
-- Откуда берутся цены. Отдельный сборщик не нужен: внешний сборщик «Полок»
-- берёт список артикулов из /api/shelf/watchlist, скребёт каждый и присылает
-- снимок, где our_price — цена ЭТОГО артикула. Значит достаточно добавить
-- артикулы конкурентов в тот же список, и их цены поедут сами. Чтобы они при
-- этом не засоряли экран «Полок», у отслеживания появляется назначение.

alter table public.wb_shelf_watch
  add column if not exists purpose text not null default 'shelf';

do $$ begin
  alter table public.wb_shelf_watch
    add constraint wb_shelf_watch_purpose_check check (purpose in ('shelf', 'price'));
exception when duplicate_object then null; end $$;

comment on column public.wb_shelf_watch.purpose is
  'shelf — наш товар, показываем его полку; price — чужой артикул, нужен только ради цены.';

create table if not exists public.wb_price_watch (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  /** Наш товар, для которого собираем сравнение. */
  our_nm_id bigint not null,
  /** Артикул конкурента. */
  competitor_nm_id bigint not null,
  /** Подпись из таблицы владельца: бренд или пометка вроде «мало заказов». */
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cabinet_id, our_nm_id, competitor_nm_id)
);

create index if not exists wb_price_watch_our_idx
  on public.wb_price_watch (cabinet_id, our_nm_id) where active;
create index if not exists wb_price_watch_competitor_idx
  on public.wb_price_watch (competitor_nm_id) where active;

alter table public.wb_price_watch enable row level security;
revoke all on table public.wb_price_watch from anon, authenticated;
grant all on table public.wb_price_watch to service_role;
