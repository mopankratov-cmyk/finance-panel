-- §27.28 ТЗ: количественный и стоимостный баланс проверяется на любую дату.
--
-- Регистр stock_moves уже честен по построению (append-only, остаток = SUM
-- по всей истории) — не хватало только отчёта, который явно раскладывает
-- сумму по видам движения и показывает, что начальный + движения периода
-- сходятся с конечным. Read-only, ничего не пишет.
--
-- Два пункта формулы ТЗ («оприходованные излишки», «возврат поставщику») не
-- выделяются в регистре отдельным kind (излишки тонут внутри обычного
-- receipt/adjustment, возврата поставщику нет вовсе) — эта функция честно
-- отдаёт то, что есть по kind, а не подставляет чужой смысл под чужую
-- цифру. Разметка «не отслеживается отдельно» — на стороне роута/экрана.

create or replace function public.stock_balance_check(
  p_legal_entity_id uuid,
  p_as_of date,
  p_from date default null,
  p_warehouse_id uuid default null
)
returns table (bucket text, qty integer, amount numeric(14, 2))
language sql
stable
security definer
set search_path = public
as $stock_balance_check$
  with scoped as (
    select kind, qty, amount,
      -- Московские сутки, не UTC: тот же приём, что уже закреплён в
      -- stock_moves_period_guard — иначе первые ~3 часа дня уезжают не туда.
      (occurred_at at time zone 'Europe/Moscow')::date as d
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id
      and (p_warehouse_id is null or warehouse_id = p_warehouse_id)
  )
  select 'opening'::text, coalesce(sum(qty), 0)::integer, coalesce(sum(amount), 0)::numeric(14, 2)
    from scoped where p_from is not null and d < p_from
  union all
  select kind, sum(qty)::integer, sum(amount)::numeric(14, 2)
    from scoped where d <= p_as_of and (p_from is null or d >= p_from) group by kind
  union all
  select 'closing'::text, coalesce(sum(qty), 0)::integer, coalesce(sum(amount), 0)::numeric(14, 2)
    from scoped where d <= p_as_of;
$stock_balance_check$;

revoke all on function public.stock_balance_check(uuid, date, date, uuid) from public;
grant execute on function public.stock_balance_check(uuid, date, date, uuid) to service_role;
