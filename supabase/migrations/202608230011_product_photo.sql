-- Фото товара в карточке и во всех списках склада.
--
-- Для позиций с карточкой WB фото берётся из баскета по nm_id — хранить его не нужно.
-- Но у своего товара карточки может не быть вовсе (новинка приехала раньше, чем её
-- завели на маркетплейсе), и тогда показать нечего. Это поле — ручная ссылка на фото
-- для таких позиций; когда карточка появится, приоритет остаётся за ней.

alter table public.products
  add column if not exists photo_url text;

notify pgrst, 'reload schema';

-- Остатки отдают фото вместе со строкой: иначе список ходил бы за ним отдельным запросом.
drop view if exists public.stock_balances;

create view public.stock_balances as
select
  m.legal_entity_id,
  m.warehouse_id,
  m.product_id,
  max(p.article) as article,
  max(p.name) as name,
  max(p.nm_id) as nm_id,
  max(p.photo_url) as photo_url,
  sum(m.qty)::integer as qty,
  sum(m.amount)::numeric(14, 2) as amount,
  case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else 0 end as unit_cost,
  max(m.occurred_at) as last_move_at
from public.stock_moves m
join public.products p on p.id = m.product_id
group by m.legal_entity_id, m.warehouse_id, m.product_id;

revoke all on public.stock_balances from anon, authenticated;

notify pgrst, 'reload schema';

-- products_view была создана через `p.*`, а Postgres разворачивает звёздочку в момент
-- создания: новая колонка сама в представление не попадает. Пересоздаём явно.
drop view if exists public.products_view;

create view public.products_view as
select
  p.id, p.legal_entity_id, p.article, p.name, p.barcode, p.category, p.brand, p.nm_id,
  p.photo_url, p.factory_price, p.factory_currency, p.weight_kg,
  p.length_cm, p.width_cm, p.height_cm, p.min_stock, p.season,
  p.is_active, p.note, p.created_by, p.created_at, p.updated_at,
  case
    when p.length_cm is not null and p.width_cm is not null and p.height_cm is not null
      then round((p.length_cm * p.width_cm * p.height_cm) / 1000.0, 3)
    else null
  end as volume_liters
from public.products p;

revoke all on public.products_view from anon, authenticated;

notify pgrst, 'reload schema';
