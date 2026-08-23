-- Себестоимость, введённая в «Складе», доходит до маржи.
--
-- Ловушка, которую видно только на стыке: себестоимость живёт в двух местах.
-- `products.factory_price` — карточка товара в модуле «Склад», куда владелец вносит
-- цену. `product_costs.cost_rub` — то, из чего считают маржу РНП, ОПиУ и юнит-экономика.
-- Это разные таблицы, и без связи получалось бы так: цену поправили в «Складе»,
-- а маржа в отчётах осталась старой — молча.
--
-- Триггер держит их согласованными в одну сторону: карточка товара → расчёт маржи.
-- Обратную сторону не делаем: `product_costs` наполняется ещё и импортами, и
-- двусторонняя синхронизация превратилась бы в гонку, где последний писавший прав.

create or replace function public.sync_product_cost_to_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $sync_product_cost$
declare
  v_entity text;
begin
  -- Пустая цена ничего не перетирает: «не знаю» не должно стирать известное.
  if new.factory_price is null or new.factory_price <= 0 then
    return new;
  end if;
  -- Валюта, отличная от рубля, в маржу не идёт — там всё в рублях, а курса здесь нет.
  if coalesce(new.factory_currency, 'RUB') <> 'RUB' then
    return new;
  end if;

  select name into v_entity from public.legal_entities where id = new.legal_entity_id;

  insert into public.product_costs (article, name, brand, entity, category, cost_rub, wb_barcode, updated_at)
  values (
    new.article,
    coalesce(nullif(new.name, ''), new.article),
    coalesce(new.brand, ''),
    coalesce(v_entity, ''),
    new.category,
    new.factory_price,
    new.barcode,
    now()
  )
  on conflict (article) do update
  set cost_rub = excluded.cost_rub,
      name = case when product_costs.name is null or product_costs.name = '' then excluded.name else product_costs.name end,
      category = coalesce(excluded.category, product_costs.category),
      wb_barcode = coalesce(excluded.wb_barcode, product_costs.wb_barcode),
      updated_at = now();

  return new;
end;
$sync_product_cost$;

drop trigger if exists products_sync_cost on public.products;
create trigger products_sync_cost
after insert or update of factory_price, factory_currency, article on public.products
for each row execute function public.sync_product_cost_to_costs();

revoke all on function public.sync_product_cost_to_costs() from public;

-- Разовая сверка: то, что уже введено в карточках, доносим до расчёта маржи.
update public.product_costs costs
set cost_rub = p.factory_price, updated_at = now()
from public.products p
where lower(p.article) = lower(costs.article)
  and p.factory_price is not null and p.factory_price > 0
  and coalesce(p.factory_currency, 'RUB') = 'RUB'
  and costs.cost_rub is distinct from p.factory_price;

notify pgrst, 'reload schema';
