-- Номер документа выдаётся один раз — ЧАСТЬ 2 из 2: только процедуры.
--
-- В этом файле НЕТ ни одного create table и ни одного alter table.
-- Схема — в 202608250028.

-- ---------------------------------------------------------------------------
-- 1. Счётчик номеров не ходит назад
-- ---------------------------------------------------------------------------
-- Обнулить счётчик — значит выдать заново номера, которые уже разошлись по
-- отметкам сторно и по переписке с фулфилментом. Последствия тихие: документ
-- не запишется из-за уникального номера, а отмена соврёт «уже сторнирован».
-- Дешевле запретить.

create or replace function public.stock_doc_counters_forward_only()
returns trigger
language plpgsql
as $stock_doc_counters_forward_only$
begin
  if tg_op = 'DELETE' then
    raise exception 'счётчик номеров % % удалять нельзя: номера уже разошлись по документам', old.kind, old.year;
  end if;
  if new.last < old.last then
    raise exception 'счётчик номеров % % не может уменьшиться с % до %', old.kind, old.year, old.last, new.last;
  end if;
  return new;
end;
$stock_doc_counters_forward_only$;

drop trigger if exists stock_doc_counters_forward_only_trigger on public.stock_doc_counters;
create trigger stock_doc_counters_forward_only_trigger
  before update or delete on public.stock_doc_counters
  for each row execute function public.stock_doc_counters_forward_only();

-- ---------------------------------------------------------------------------
-- 2. Сторно запоминает проводку, а не номер
-- ---------------------------------------------------------------------------
-- Отличие от 202608250027 только в ключе повторной отмены: раньше это была
-- человеческая строка номера, теперь — сама проводка и кабинет. Строки, у
-- которых ссылки нет (сторно до этой миграции), проверяются по-старому.

create or replace function public.post_doc_reversal(
  p_source_movement_doc_id text,
  p_new_movement_doc_id text,
  p_source_number text,
  p_actor text default null,
  p_cabinet_id uuid default null
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

  if exists (
    select 1
    from public.stock_moves
    where doc_type = 'reversal'
      and (
        -- Точный ключ: та же проводка и тот же кабинет. Без кабинета отмена
        -- накрывала все строки, поэтому её повтор запрещён целиком.
        (reverses_doc_id = p_source_movement_doc_id
          and (p_cabinet_id is null or cabinet_id is not distinct from p_cabinet_id))
        -- Строки сторно, записанные до появления точного ключа.
        or (reverses_doc_id is null and note = p_source_number)
      )
  ) then
    raise exception 'document already reversed';
  end if;

  for v_line in
    select legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article, qty, amount, kind
    from public.stock_moves
    where doc_id = p_source_movement_doc_id
      and (p_cabinet_id is null or cabinet_id = p_cabinet_id)
    order by id
  loop
    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, reverses_doc_id, note, created_by
    ) values (
      v_line.legal_entity_id, v_line.cabinet_id, v_line.warehouse_id, v_line.product_id, v_line.variant_id,
      v_line.nm_id, v_line.article,
      -v_line.qty, -v_line.amount, v_line.kind, 'reversal', p_new_movement_doc_id,
      p_source_movement_doc_id, p_source_number, p_actor
    );
    v_moves := v_moves + 1;
    v_qty := v_qty + abs(v_line.qty);
    v_amount := v_amount + abs(v_line.amount);
  end loop;

  if v_moves = 0 then raise exception 'source document has no movements'; end if;

  return jsonb_build_object('lines', v_moves, 'qty', v_qty, 'amount', v_amount);
end;
$post_doc_reversal$;

revoke all on function public.post_doc_reversal(text, text, text, text, uuid) from public;
grant execute on function public.post_doc_reversal(text, text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
