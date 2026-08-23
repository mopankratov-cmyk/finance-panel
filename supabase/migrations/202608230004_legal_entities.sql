-- Юрлицо как ось учёта: товар принадлежит ИП или ООО, а не кабинету маркетплейса.
--
-- Причина правки. В 202608230003 склад, партия и движения были привязаны к кабинету WB.
-- Это неверно: с одного юрлица товар поставляется в 2–3 кабинета, и при кабинетной
-- привязке одна партия распалась бы на несколько несвязанных складов, а себестоимость
-- посчиталась бы по каждому отдельно. Правильная ось — юрлицо: оно владеет складом,
-- партией и остатком, а кабинет появляется только в момент отгрузки на маркетплейс.
--
-- Эта же ось нужна Честному Знаку: токен ЧЗ принадлежит ИП, а не кабинету, и связь
-- владелец↔кабинет многие-ко-многим (Оптима торгует кодами нескольких ИП). Поэтому
-- отдельной таблицы `chz_owners` не будет — доступ к ЧЗ прицепится сюда же.

-- ---------------------------------------------------------------------------
-- 1. Справочник юрлиц
-- ---------------------------------------------------------------------------

create table if not exists public.legal_entities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  inn         text,
  kind        text not null default 'ip' check (kind in ('ip', 'ooo')),
  is_active   boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists legal_entities_name_unique
  on public.legal_entities (lower(name));
create unique index if not exists legal_entities_inn_unique
  on public.legal_entities (inn) where inn is not null;

-- Связь «юрлицо ↔ кабинет» многие-ко-многим: own — юрлицо само продаёт через кабинет,
-- agent — продаёт через чужой кабинет по агентской схеме.
create table if not exists public.legal_entity_cabinets (
  id                uuid primary key default gen_random_uuid(),
  legal_entity_id   uuid not null references public.legal_entities(id) on delete cascade,
  cabinet_id        uuid not null references public.wb_cabinets(id) on delete cascade,
  relation          text not null default 'own' check (relation in ('own', 'agent')),
  created_at        timestamptz not null default now()
);

create unique index if not exists legal_entity_cabinets_pair_unique
  on public.legal_entity_cabinets (legal_entity_id, cabinet_id);
create index if not exists legal_entity_cabinets_cabinet_idx
  on public.legal_entity_cabinets (cabinet_id, relation);

-- ---------------------------------------------------------------------------
-- 2. Наши юрлица
-- ---------------------------------------------------------------------------
-- ИНН взяты из подключённых кабинетов, названия — со счетов финансового контура.
-- Кабинет СЛОЁНО намеренно не привязан: он внешнего селлера, юрлицо не наше.

insert into public.legal_entities (name, inn, kind, note) values
  ('ИП Панкратов',    '280888215133', 'ip',  'кабинет COSMOS SHOP'),
  ('ИП Кучеренко',    '281544542590', 'ip',  'кабинет CLERIN'),
  ('ИП Филиппов',     '330573647518', 'ip',  'кабинет Retail Family; счёта в финансовом контуре нет'),
  ('ООО Оптима',      '9704015176',   'ooo', 'кабинет Оптима — NORVIA / RIOBOX'),
  ('ИП Митриченко',    null,          'ip',  'есть счёт в финансах, кабинет не подключён'),
  ('ООО ГЛОБАЛКОС',    null,          'ooo', 'есть счёт в финансах, кабинет не подключён'),
  ('ООО Иллюмей',      null,          'ooo', 'есть счёт в финансах, кабинет не подключён'),
  ('ООО Прайм Бьюти',  null,          'ooo', 'есть счёт в финансах, кабинет не подключён'),
  ('ООО РИО',          null,          'ooo', 'есть счёт в финансах, кабинет не подключён')
on conflict do nothing;

-- Собственные кабинеты подхватываются по ИНН — так связь не разъедется, если кабинет
-- пересоздадут. Агентские связи здесь не заводятся: их проставляет владелец руками,
-- угадывать, кто чьим агентом торгует, нельзя.
insert into public.legal_entity_cabinets (legal_entity_id, cabinet_id, relation)
select entity.id, cabinet.id, 'own'
from public.legal_entities entity
join public.wb_cabinets cabinet on cabinet.inn = entity.inn
where entity.inn is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Склад переезжает с кабинета на юрлицо
-- ---------------------------------------------------------------------------

alter table public.warehouses
  add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete restrict;
alter table public.stock_batches
  add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete restrict;
alter table public.stock_moves
  add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete restrict;

-- Уже заведённые строки: юрлицо берётся из собственного кабинета.
update public.warehouses w
set legal_entity_id = link.legal_entity_id
from public.legal_entity_cabinets link
where link.cabinet_id = w.cabinet_id and link.relation = 'own' and w.legal_entity_id is null;

update public.stock_batches b
set legal_entity_id = link.legal_entity_id
from public.legal_entity_cabinets link
where link.cabinet_id = b.cabinet_id and link.relation = 'own' and b.legal_entity_id is null;

update public.stock_moves m
set legal_entity_id = link.legal_entity_id
from public.legal_entity_cabinets link
where link.cabinet_id = m.cabinet_id and link.relation = 'own' and m.legal_entity_id is null;

-- Склад без юрлица дальше не имеет смысла: приходовать не на кого.
do $warehouse_check$
begin
  if exists (select 1 from public.warehouses where legal_entity_id is null) then
    raise exception 'есть склады, кабинет которых не связан ни с одним юрлицом — свяжите их до применения миграции';
  end if;
end $warehouse_check$;

alter table public.warehouses alter column legal_entity_id set not null;
alter table public.stock_batches alter column legal_entity_id set not null;
alter table public.stock_moves alter column legal_entity_id set not null;

-- Кабинет остаётся только у движения и только как «куда отгрузили»: приход на склад
-- юрлица кабинета не имеет, отгрузка на маркетплейс — имеет.
alter table public.stock_moves alter column cabinet_id drop not null;

drop index if exists warehouses_cabinet_name_unique;
drop index if exists warehouses_cabinet_idx;
alter table public.warehouses drop column if exists cabinet_id;
create unique index if not exists warehouses_entity_name_unique
  on public.warehouses (legal_entity_id, lower(name));
create index if not exists warehouses_entity_idx
  on public.warehouses (legal_entity_id, is_active, position);

alter table public.stock_batches drop column if exists cabinet_id;
create index if not exists stock_batches_entity_idx
  on public.stock_batches (legal_entity_id, created_at desc);

drop index if exists stock_moves_balance_idx;
drop index if exists stock_moves_recent_idx;
create index if not exists stock_moves_balance_idx
  on public.stock_moves (legal_entity_id, warehouse_id, nm_id);
create index if not exists stock_moves_recent_idx
  on public.stock_moves (legal_entity_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 4. Остаток считается по юрлицу
-- ---------------------------------------------------------------------------

drop view if exists public.stock_balances;
create view public.stock_balances as
select
  m.legal_entity_id,
  m.warehouse_id,
  m.nm_id,
  coalesce((array_agg(m.article order by m.occurred_at desc) filter (where m.article <> ''))[1], '') as article,
  sum(m.qty)::integer as qty,
  sum(m.amount)::numeric(14, 2) as amount,
  case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else 0 end as unit_cost,
  max(m.occurred_at) as last_move_at
from public.stock_moves m
group by m.legal_entity_id, m.warehouse_id, m.nm_id;

-- ---------------------------------------------------------------------------
-- 5. Проведение приёмки: кабинет приёмки → его юрлицо
-- ---------------------------------------------------------------------------
-- Приёмка по-прежнему заводится в кабинете (так устроена purchase_receipts), но
-- приходуется на юрлицо этого кабинета. Если кабинет ни с одним юрлицом не связан,
-- проведение падает с внятной ошибкой, а не приходует «в никуда».

create or replace function public.post_receipt_batch(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_receipt_batch$
declare
  v_cabinet_id      uuid;
  v_entity_id       uuid;
  v_warehouse       public.warehouses%rowtype;
  v_order           public.purchase_orders%rowtype;
  v_batch_id        uuid;
  v_goods           numeric(14, 2) := 0;
  v_logistics       numeric(14, 2) := 0;
  v_extra           numeric(14, 2) := 0;
  v_overhead        numeric(14, 2) := 0;
  v_qty             integer := 0;
  v_weight_total    numeric(18, 4) := 0;
  v_by_value        boolean := true;
  v_missing_price   boolean := false;
  v_unknown_extra   boolean := false;
  v_basis           text := 'exact';
  v_note            text := null;
  v_moves           integer := 0;
  v_row             record;
  v_line_goods      numeric(14, 2);
  v_line_weight     numeric(18, 4);
  v_line_total      numeric(14, 2);
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;

  select cabinet_id, sum(coalesce(received_qty, 0))::integer
    into v_cabinet_id, v_qty
  from public.purchase_receipts
  where batch_id = p_batch_id and status = 'received' and posted_at is null
  group by cabinet_id;

  if v_cabinet_id is null then
    return jsonb_build_object('posted', 0, 'reason', 'nothing_to_post');
  end if;
  if v_qty is null or v_qty = 0 then
    return jsonb_build_object('posted', 0, 'reason', 'zero_quantity');
  end if;

  select legal_entity_id into v_entity_id
  from public.legal_entity_cabinets
  where cabinet_id = v_cabinet_id and relation = 'own'
  limit 1;
  if v_entity_id is null then raise exception 'cabinet has no legal entity'; end if;
  if v_entity_id <> v_warehouse.legal_entity_id then
    raise exception 'warehouse belongs to another legal entity';
  end if;

  select * into v_order from public.purchase_orders where receipt_batch_id = p_batch_id;

  if found then
    select
      coalesce(sum(r.received_qty * coalesce(i.unit_price, 0)), 0) * v_order.exchange_rate,
      bool_or(i.unit_price is null or i.unit_price = 0)
      into v_goods, v_missing_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null;

    select coalesce(sum(cost), 0) into v_logistics
    from public.purchase_logistics_stages where order_id = v_order.id;

    select
      coalesce(sum(case
        when currency = 'RUB' then amount
        when currency = v_order.currency then amount * v_order.exchange_rate
        else 0 end), 0),
      bool_or(currency <> 'RUB' and currency <> v_order.currency)
      into v_extra, v_unknown_extra
    from public.purchase_expenses where order_id = v_order.id;
  else
    v_missing_price := true;
  end if;

  v_overhead := v_logistics + v_extra;
  v_by_value := v_goods > 0;

  if v_missing_price or v_unknown_extra or v_order.id is null then
    v_basis := 'estimated';
  end if;
  v_note := nullif(concat_ws('; ',
    case when v_order.id is null then 'приёмка без заказа фабрике' end,
    case when v_missing_price then 'у части позиций нет цены' end,
    case when v_unknown_extra then 'расход в валюте без курса не учтён' end
  ), '');

  if v_by_value then v_weight_total := v_goods; else v_weight_total := v_qty; end if;

  v_batch_id := gen_random_uuid();
  insert into public.stock_batches (
    id, legal_entity_id, receipt_batch_id, order_id, supplier,
    goods_amount, logistics_amount, extra_amount, total_amount, total_qty,
    cost_basis, cost_note, posted_by
  ) values (
    v_batch_id, v_entity_id, p_batch_id, v_order.id, coalesce(v_order.supplier, ''),
    v_goods, v_logistics, v_extra, v_goods + v_overhead, v_qty,
    v_basis, v_note, p_actor
  );

  for v_row in
    select r.id, r.nm_id, r.article, r.received_qty, coalesce(i.unit_price, 0) as unit_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on v_order.id is not null and i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
  loop
    v_line_goods := v_row.received_qty * v_row.unit_price * coalesce(v_order.exchange_rate, 1);
    v_line_weight := case when v_by_value then v_line_goods else v_row.received_qty end;
    v_line_total := v_line_goods + case
      when v_weight_total > 0 then v_overhead * (v_line_weight / v_weight_total)
      else 0 end;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, nm_id, article, batch_id,
      qty, amount, kind, doc_type, doc_id, created_by
    ) values (
      v_entity_id, null, p_warehouse_id, v_row.nm_id, v_row.article, v_batch_id,
      v_row.received_qty, round(v_line_total, 2), 'receipt', 'purchase_receipt', p_batch_id::text, p_actor
    );

    update public.purchase_receipts
    set warehouse_id = p_warehouse_id,
        stock_batch_id = v_batch_id,
        unit_cost = round(v_line_total / v_row.received_qty, 4),
        posted_at = now(),
        updated_at = now()
    where id = v_row.id;

    v_moves := v_moves + 1;
  end loop;

  insert into public.operation_audit_log (
    cabinet_id, entity_type, entity_id, action, actor, after_data
  ) values (
    v_cabinet_id, 'stock_batch', v_batch_id, 'receipt_posted', p_actor,
    jsonb_build_object(
      'receiptBatchId', p_batch_id,
      'legalEntityId', v_entity_id,
      'warehouseId', p_warehouse_id,
      'qty', v_qty,
      'total', v_goods + v_overhead,
      'costBasis', v_basis
    )
  );

  return jsonb_build_object(
    'posted', v_moves,
    'batchId', v_batch_id,
    'qty', v_qty,
    'total', v_goods + v_overhead,
    'costBasis', v_basis,
    'costNote', v_note
  );
end;
$post_receipt_batch$;

-- ---------------------------------------------------------------------------
-- 6. Доступы
-- ---------------------------------------------------------------------------

alter table public.legal_entities enable row level security;
alter table public.legal_entity_cabinets enable row level security;

drop policy if exists "all" on public.legal_entities;
drop policy if exists "all" on public.legal_entity_cabinets;
create policy "all" on public.legal_entities for all using (true) with check (true);
create policy "all" on public.legal_entity_cabinets for all using (true) with check (true);

revoke all on table public.legal_entities from anon, authenticated;
revoke all on table public.legal_entity_cabinets from anon, authenticated;
revoke all on public.stock_balances from anon, authenticated;
