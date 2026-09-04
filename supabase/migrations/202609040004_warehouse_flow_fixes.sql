-- Правки по итогам ревью движения товаров — ЧАСТЬ 1 из 2: схема.
--
-- В этом файле НЕТ функций (процедуры — в 202609040005): редактор Supabase
-- ломает plpgsql, если рядом лежит DDL.
--
-- Причина. Журнал событий защищён триггером «только вставка». Внешние ключи
-- с каскадом этому противоречат: удаляя склад, Postgres пытается ОБНОВИТЬ
-- строки журнала (on delete set null), а удаляя юрлицо — УДАЛИТЬ их
-- (on delete cascade). Обе операции упрутся в триггер, и удаление
-- провалится с невнятной ошибкой append-only.
--
-- Как правильно. Ровно так же, как у регистра движений: ссылка запрещает
-- удаление, а не переписывает историю. Журнал переживает и склад, и юрлицо —
-- он о том, что уже случилось.

alter table public.warehouse_events
  drop constraint if exists warehouse_events_warehouse_id_fkey;
alter table public.warehouse_events
  add constraint warehouse_events_warehouse_id_fkey
  foreign key (warehouse_id) references public.warehouses(id) on delete restrict;

alter table public.warehouse_events
  drop constraint if exists warehouse_events_legal_entity_id_fkey;
alter table public.warehouse_events
  add constraint warehouse_events_legal_entity_id_fkey
  foreign key (legal_entity_id) references public.legal_entities(id) on delete restrict;

notify pgrst, 'reload schema';
