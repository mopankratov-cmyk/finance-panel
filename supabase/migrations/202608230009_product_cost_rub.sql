-- Себестоимость товара вносится в рублях.
--
-- Решение владельца: цену держим в рублях, а не в валюте фабрики. Тогда приёмке
-- не нужен курс — она берёт цену из карточки как есть. Курс остаётся нужен только
-- заказу фабрике, где он и задаётся явно.
--
-- Заодно исправляется упущение переноса: в `product_costs` себестоимость уже была
-- в рублях (`cost_rub`), но в карточки товаров не попала — они приехали с пустой ценой.

alter table public.products alter column factory_currency set default 'RUB';

-- Переносим рублёвую себестоимость там, где цена ещё не заполнена вручную.
update public.products p
set factory_price = costs.cost_rub,
    factory_currency = 'RUB',
    updated_at = now()
from public.product_costs costs
where lower(p.article) = lower(costs.article)
  and p.factory_price is null
  and costs.cost_rub is not null
  and costs.cost_rub > 0;

-- Товары, заведённые до этой миграции с валютой по умолчанию, но без цены:
-- валюту приводим к рублю, чтобы поле не сбивало с толку пустой единицей измерения.
update public.products
set factory_currency = 'RUB', updated_at = now()
where factory_price is null and factory_currency = 'CNY';

notify pgrst, 'reload schema';
