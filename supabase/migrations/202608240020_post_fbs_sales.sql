-- Продажи FBS списывают склад — ЧАСТЬ 2 из 2: только функция.
--
-- В этом файле НЕТ ни одного `create table` — и это условие его применимости:
-- редактор Supabase дописывает включение RLS к скриптам, где таблицы создаются,
-- и промахивается прямо в тело функции. Схема лежит в 202608240019.
--
-- Переменные объявлены скалярами, а не через %rowtype, по той же причине:
-- разбор declare-блока — ровно то место, где редактор принимает переменную за
-- таблицу. Скаляры не дают ему повода.
--
-- Чьё юрлицо списывать, решает ТОВАР, а не кабинет: пеналы продаются через
-- агентский кабинет Оптимы, но принадлежат ООО РИО. Кабинет остаётся на
-- движении как канал продажи, а не как владелец.

create or replace function public.post_fbs_sales(
  p_legal_entity_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_fbs_sales$
declare
  v_exists      boolean;
  v_line        record;
  v_unit_cost   numeric(14, 2);
  v_written     integer := 0;
  v_skipped     integer := 0;
  v_negative    integer := 0;
  v_available   integer;
  v_product_id  uuid;
  v_nm_id       bigint;
  v_article     text;
begin
  select true into v_exists from public.warehouses where id = p_warehouse_id;
  if v_exists is not true then raise exception 'warehouse not found'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('written', 0, 'skipped', 0, 'negative', 0);
  end if;

  for v_line in
    select
      item->>'srid' as srid,
      (item->>'variantId')::uuid as variant_id,
      nullif(item->>'cabinetId', '')::uuid as cabinet_id,
      coalesce((item->>'qty')::integer, 1) as qty,
      (item->>'occurredAt')::timestamptz as occurred_at
    from jsonb_array_elements(p_lines) as item
  loop
    if v_line.srid is null or v_line.srid = '' then continue; end if;

    -- Эта продажа уже списана прошлым запуском.
    if exists (select 1 from public.stock_moves where doc_type = 'fbs_sale' and doc_id = v_line.srid) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select v.product_id, p.nm_id, p.article
      into v_product_id, v_nm_id, v_article
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.id = v_line.variant_id;
    if v_product_id is null then v_skipped := v_skipped + 1; continue; end if;

    select
      case when coalesce(sum(qty), 0) > 0 then round(coalesce(sum(amount), 0) / sum(qty), 2) else 0 end,
      coalesce(sum(qty), 0)
      into v_unit_cost, v_available
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id
      and warehouse_id = p_warehouse_id
      and variant_id = v_line.variant_id;

    -- В минус уходим осознанно и считаем такие случаи: продажа — это факт,
    -- случившийся у маркетплейса, а не наше намерение. Отказ записать её сделал
    -- бы регистр «красивым» и неверным; минус честно говорит, что о приходе
    -- этой позиции регистр не знает.
    if v_available < v_line.qty then v_negative := v_negative + 1; end if;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, occurred_at, note, created_by
    ) values (
      p_legal_entity_id, v_line.cabinet_id, p_warehouse_id, v_product_id, v_line.variant_id,
      v_nm_id, v_article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'sale', 'fbs_sale', v_line.srid,
      coalesce(v_line.occurred_at, now()), 'fbs_sale', p_actor
    );
    v_written := v_written + 1;
    v_product_id := null;
  end loop;

  return jsonb_build_object('written', v_written, 'skipped', v_skipped, 'negative', v_negative);
end;
$post_fbs_sales$;

revoke all on function public.post_fbs_sales(uuid, uuid, jsonb, text) from public;
grant execute on function public.post_fbs_sales(uuid, uuid, jsonb, text) to service_role;

notify pgrst, 'reload schema';
