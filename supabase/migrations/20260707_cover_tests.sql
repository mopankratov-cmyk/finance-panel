-- Реальный A/B (точнее — контролируемый раскат во времени, см. docs/отложено.md
-- п.1: официальный WB API не даёт per-variant атрибуцию кликов) тест обложки
-- карточки: меняем порядок УЖЕ загруженных фото через Content API (главным
-- становится выбранное), фиксируем момент переключения, дальше сравниваем
-- конверсию открытие→корзина (wb_funnel_daily) до/после.
create table if not exists public.cover_tests (
  id            bigint generated always as identity primary key,
  cabinet_id    uuid references public.wb_cabinets(id) on delete cascade,
  nm_id         bigint not null,
  article       text not null default '',
  photos_before jsonb not null default '[]'::jsonb,
  photos_after  jsonb not null default '[]'::jsonb,
  switched_at   timestamptz not null default now(),
  created_by    text,
  created_at    timestamptz not null default now()
);

create index if not exists cover_tests_nm_idx on public.cover_tests (nm_id, switched_at desc);

alter table public.cover_tests enable row level security;
create policy "all" on public.cover_tests for all using (true) with check (true);
