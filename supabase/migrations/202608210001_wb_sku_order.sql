-- Ручной порядок выдачи артикулов («последовательность» из таблицы менеджера).
-- Настраивается в РНП, применяется на всех экранах со списками SKU кабинета.
-- Массив, а не строки: порядок — одна атомарная сущность, правится целиком.
create table if not exists wb_sku_order (
  cabinet_id uuid primary key references wb_cabinets(id) on delete cascade,
  nm_ids bigint[] not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
