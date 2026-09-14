-- Закрытие периода: один BEFORE INSERT триггер на самом регистре, а не
-- проверка, продублированная в каждой из 9 проводящих функций
-- (post_receipt_batch, post_shipment, post_writeoff, post_transfer,
-- post_return, post_doc_reversal, post_fbs_sales, post_shipment_task,
-- correct_receipt_batch, post_opening_balance — десятая, только что
-- добавленная). Дублирование в 9+ местах гарантированно разойдётся при
-- следующей правке любой из них; один триггер на INSERT ловит их все
-- одинаково, включая любую будущую функцию.
--
-- Пока period_closed_through = null у всех юрлиц (по умолчанию, колонка
-- новая) — триггер не меняет ничего в поведении склада: проверка активна
-- только после того, как период явно закрыли.

create or replace function public.stock_moves_period_guard()
returns trigger
language plpgsql
as $stock_moves_period_guard$
declare
  v_closed_through date;
begin
  select period_closed_through into v_closed_through
  from public.legal_entities
  where id = new.legal_entity_id;

  -- Дата закрытия — московский календарный день, а не UTC: незакреплённый
  -- ::date у occurred_at (timestamptz) уже один раз сдвигал границу суток в
  -- этом репозитории (см. 202608250032_kiz_summary_function.sql) — первые
  -- ~3 часа каждого московского дня иначе попадали бы в предыдущие UTC-сутки
  -- и упирались в закрытый период, хотя по календарю бизнеса он уже открыт.
  if v_closed_through is not null and (new.occurred_at at time zone 'Europe/Moscow')::date <= v_closed_through then
    raise exception 'period closed through %: cannot post a move dated %', v_closed_through, (new.occurred_at at time zone 'Europe/Moscow')::date;
  end if;

  return new;
end;
$stock_moves_period_guard$;

drop trigger if exists stock_moves_period_guard_trigger on public.stock_moves;
create trigger stock_moves_period_guard_trigger
before insert on public.stock_moves
for each row execute function public.stock_moves_period_guard();
