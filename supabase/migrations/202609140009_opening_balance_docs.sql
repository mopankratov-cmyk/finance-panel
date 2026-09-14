-- Начальные остатки (§5.1 пайплайна закупок): новый вид документа склада —
-- юрлицо заводят в системе без истории движений одним ручным вводом, не
-- через приёмку. Только DDL — тело функции в отдельном файле рядом
-- (202609140010), тот же приём, что уже применялся в этом контуре: миграции
-- со смешанным DDL и телом plpgsql редактор Supabase путает.

alter table public.stock_docs drop constraint if exists stock_docs_kind_check;
alter table public.stock_docs add constraint stock_docs_kind_check
  check (kind in ('shipment', 'transfer', 'writeoff', 'return', 'receipt', 'adjustment', 'opening'));
