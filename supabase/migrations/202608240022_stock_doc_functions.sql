-- Документ склада — ЧАСТЬ 2 из 2: только процедуры.
--
-- В этом файле НЕТ ни одного `create table` — условие его применимости.
-- Переменные объявлены скалярами, а не через %rowtype, по той же причине.
-- Схема лежит в 202608240021.

-- Номер документа: ОТГ-2026-0001. Выдаётся атомарно — два одновременных
-- проведения не должны получить один номер.
create or replace function public.next_stock_doc_number(p_kind text, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $next_stock_doc_number$
declare
  v_year   integer;
  v_next   integer;
  v_prefix text;
begin
  v_year := extract(year from p_at)::integer;
  v_prefix := case p_kind
    when 'shipment' then 'ОТГ'
    when 'transfer' then 'ПЕР'
    when 'writeoff' then 'СПС'
    when 'return'   then 'ВОЗ'
    when 'receipt'  then 'ПРМ'
    else 'ДОК'
  end;

  insert into public.stock_doc_counters (kind, year, last)
  values (p_kind, v_year, 1)
  on conflict (kind, year) do update set last = public.stock_doc_counters.last + 1
  returning last into v_next;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$next_stock_doc_number$;

-- Сторно: обратные движения со ссылкой на исходный документ.
--
-- Регистр append-only — удалить проведённое нельзя, и это правильно: история не
-- должна переписываться. Единственная честная отмена — записать те же строки со
-- знаком минус и связать их с исходником. В остатке результат тот же, а в
-- журнале видно и ошибку, и её исправление.
create or replace function public.post_doc_reversal(
  p_source_movement_doc_id text,
  p_new_movement_doc_id text,
  p_source_number text,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_doc_reversal$
declare
  v_line      record;
  v_moves     integer := 0;
  v_qty       integer := 0;
  v_amount    numeric(14, 2) := 0;
begin
  if p_source_movement_doc_id is null or p_source_movement_doc_id = '' then
    raise exception 'source document has no movements';
  end if;
  if exists (select 1 from public.stock_moves where doc_type = 'reversal' and note = p_source_number) then
    raise exception 'document already reversed';
  end if;

  for v_line in
    select legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article, qty, amount, kind
    from public.stock_moves
    where doc_id = p_source_movement_doc_id
    order by id
  loop
    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      v_line.legal_entity_id, v_line.cabinet_id, v_line.warehouse_id, v_line.product_id, v_line.variant_id,
      v_line.nm_id, v_line.article,
      -v_line.qty, -v_line.amount, v_line.kind, 'reversal', p_new_movement_doc_id, p_source_number, p_actor
    );
    v_moves := v_moves + 1;
    v_qty := v_qty + abs(v_line.qty);
    v_amount := v_amount + abs(v_line.amount);
  end loop;

  if v_moves = 0 then raise exception 'source document has no movements'; end if;

  return jsonb_build_object('lines', v_moves, 'qty', v_qty, 'amount', v_amount);
end;
$post_doc_reversal$;

revoke all on function public.next_stock_doc_number(text, timestamptz) from public;
grant execute on function public.next_stock_doc_number(text, timestamptz) to service_role;
revoke all on function public.post_doc_reversal(text, text, text, text) from public;
grant execute on function public.post_doc_reversal(text, text, text, text) to service_role;

notify pgrst, 'reload schema';
