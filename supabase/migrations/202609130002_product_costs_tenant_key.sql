-- Себестоимость ключуется голым article — межарендная запись поверх чужого
-- юрлица (аудит P0, /api/costs POST).
--
-- app/api/costs/route.ts POST искал и обновлял строку по одному только
-- article, без какой-либо границы организации, и на вставке всегда проставлял
-- entity = OPIU_ENTITY (константа, "ИП ПАНКРАТОВ" — lib/opiu/constants.ts)
-- независимо от того, кто пишет. Право cost.edit при этом есть у seller И
-- seller_owner (внешний контур, lib/auth/permissions.ts) — то есть внешний
-- клиент, чей артикул текстуально совпал с чужим (в том числе с артикулом
-- ВЛАДЕЛЬЦА панели), одним POST переписывал себестоимость этой чужой позиции.
-- Это не чтение чужого — это ЗАПИСЬ поверх чужих финансовых данных.
--
-- Существующие строки накоплены ДО появления внешнего контура (seller_owner
-- введён в матрице прав 09.2026) и все относятся к внутренней компании —
-- поэтому backfill проставляет им organization_id внутренней организации
-- одним UPDATE, без риска задеть настоящие внешние записи (их пока не было).
do $$
declare
  internal_org uuid;
begin
  select id into internal_org from public.organizations where kind = 'internal' order by created_at limit 1;
  if internal_org is null then
    raise notice 'product_costs_tenant_key: internal organization not found — organization_id column added but NOT backfilled; apply manually before relying on the new boundary';
  end if;

  alter table public.product_costs
    add column if not exists organization_id uuid;

  if internal_org is not null then
    update public.product_costs
      set organization_id = internal_org
      where organization_id is null;
  end if;
end $$;

comment on column public.product_costs.organization_id is
  'Организация-владелец записи. NULL у старых непрошедших backfill строк трактуется кодом как «внутренняя компания», а не «фильтра нет» — граница держится в app/api/costs/route.ts, не только здесь.';

-- Старая уникальность (если она вообще была) держалась на голом article —
-- то есть буквально не давала разным организациям иметь совпадающий артикул.
-- Ищем и снимаем её по факту (по составу колонок, а не по угаданному имени:
-- таблица заведена до истории миграций этого репозитория, точное имя
-- constraint'а неизвестно), прежде чем завести новую составную уникальность.
do $$
declare
  rec record;
begin
  for rec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'product_costs'
      and con.contype in ('p', 'u')
      and (
        select array_agg(attname order by attname)
        from unnest(con.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      ) = array['article']::name[]
  loop
    execute format('alter table public.product_costs drop constraint %I', rec.conname);
    raise notice 'product_costs_tenant_key: dropped single-column constraint % on (article)', rec.conname;
  end loop;

  for rec in
    select indexname
    from pg_indexes
    where schemaname = 'public' and tablename = 'product_costs'
      and indexdef ilike '%unique%(article)%'
  loop
    execute format('drop index if exists public.%I', rec.indexname);
    raise notice 'product_costs_tenant_key: dropped single-column unique index %', rec.indexname;
  end loop;
end $$;

-- Составной ключ: артикул уникален В ГРАНИЦАХ организации, а не глобально.
-- NULLS NOT DISTINCT недоступен без учёта версии Postgres — строки без
-- backfill (internal_org не найден) в эту уникальность не попадут вовсе,
-- пока organization_id не проставлен; это осознанный компромисс ради того,
-- чтобы миграция не падала на пустой базе организаций.
create unique index if not exists product_costs_org_article_key
  on public.product_costs (organization_id, article)
  where organization_id is not null;

notify pgrst, 'reload schema';
