-- Продажи FBS списывают склад.
--
-- До сих пор в регистр движений не писал НИКТО, кроме модуля склада. Для FBW это
-- верно: товар ушёл в момент отгрузки на склад маркетплейса. Но при FBS товар
-- физически остаётся на фулфилменте и продаётся оттуда, а регистр об этом не
-- узнавал никогда — остаток на ФФ не уменьшался ни на одну штуку. Через месяц
-- работы вкладка «Остатки» превращается в декорацию.
--
-- Чьё юрлицо списывать, решает ТОВАР, а не кабинет. Пеналы продаются через
-- агентский кабинет Оптимы, но принадлежат ООО РИО — списывать надо у РИО.
-- Кабинет остаётся на движении как канал продажи, а не как владелец.
--
-- Списание включается по складу и дате, а не разом на всю историю: пока по
-- складу не проведена приёмка или инвентаризация, вычитать из него продажи
-- значит уводить остаток в минус на всю историю торговли.

alter table public.stock_moves
  drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves
  add constraint stock_moves_kind_check
  check (kind in ('receipt', 'shipment', 'writeoff', 'return', 'adjustment', 'transfer', 'sale'));

-- Настройка живёт на паре «юрлицо + склад»: склад общий, а доверять его остатку
-- каждое юрлицо начинает со своей даты — со своей приёмки или инвентаризации.
create table if not exists public.legal_entity_warehouses (
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  -- null — списание продаж выключено. Дата — с неё считаем продажи FBS.
  fbs_sales_since timestamptz,
  fbs_synced_at   timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (legal_entity_id, warehouse_id)
);

comment on table public.legal_entity_warehouses is
  'Настройки пары «юрлицо + склад»: с какой даты продажи FBS списывают этот склад.';

revoke all on public.legal_entity_warehouses from anon, authenticated;

-- Один заказ — одно движение. Повторный запуск синхронизации не должен списать
-- ту же продажу второй раз, а запусков будет много: это фоновая работа.
create unique index if not exists stock_moves_fbs_sale_unique
  on public.stock_moves (doc_id)
  where doc_type = 'fbs_sale';

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
  v_warehouse   public.warehouses%rowtype;
  v_line        record;
  v_unit_cost   numeric(14, 2);
  v_written     integer := 0;
  v_skipped     integer := 0;
  v_negative    integer := 0;
  v_available   integer;
  v_variant     public.product_variants%rowtype;
  v_product     public.products%rowtype;
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('written', 0, 'skipped', 0, 'negative', 0);
  end if;

  for v_line in
    select
      item->>'srid' as srid,
      (item->>'variantId')::uuid as variant_id,
      (item->>'cabinetId')::uuid as cabinet_id,
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

    select * into v_variant from public.product_variants where id = v_line.variant_id;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    select * into v_product from public.products where id = v_variant.product_id;

    select
      case when coalesce(sum(qty), 0) > 0 then round(coalesce(sum(amount), 0) / sum(qty), 2) else 0 end,
      coalesce(sum(qty), 0)
      into v_unit_cost, v_available
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and variant_id = v_line.variant_id;

    -- В минус уходим осознанно и считаем такие случаи: продажа — это факт,
    -- случившийся у маркетплейса, а не наше намерение. Отказ записать её сделал
    -- бы регистр «красивым» и неверным; минус честно говорит, что о приходе
    -- этой позиции регистр не знает.
    if v_available < v_line.qty then v_negative := v_negative + 1; end if;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, occurred_at, note, created_by
    ) values (
      p_legal_entity_id, v_line.cabinet_id, p_warehouse_id, v_variant.product_id, v_line.variant_id,
      v_product.nm_id, v_product.article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'sale', 'fbs_sale', v_line.srid,
      coalesce(v_line.occurred_at, now()), 'fbs_sale', p_actor
    );
    v_written := v_written + 1;
  end loop;

  return jsonb_build_object('written', v_written, 'skipped', v_skipped, 'negative', v_negative);
end;
$post_fbs_sales$;

revoke all on function public.post_fbs_sales(uuid, uuid, jsonb, text) from public;
grant execute on function public.post_fbs_sales(uuid, uuid, jsonb, text) to service_role;

notify pgrst, 'reload schema';
