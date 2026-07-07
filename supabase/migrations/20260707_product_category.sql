-- Категория/группа товара (свободный текст, продавец сам заводит названия — как
-- "Все группы" в infernoff.ru/zakupki: Ковры/Сумки женские/Игрушки/Сезонка/...).
-- Отдельно от brand (реальный бренд товара) и entity (юрлицо-продавец) —
-- ни одно из них не является товарной категорией.

alter table public.product_costs add column if not exists category text;
create index if not exists product_costs_category on public.product_costs (category);
