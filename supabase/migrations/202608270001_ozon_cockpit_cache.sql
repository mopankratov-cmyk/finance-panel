-- Снимок кокпита Ozon — в базе, а не в памяти процесса.
--
-- Кэш Next живёт внутри одного экземпляра функции и пропадает при каждом
-- деплое. Ночной прогрев наполнял его в СВОЁМ экземпляре, а пользователь
-- попадал в другой — и первое открытие экрана считалось живьём: 21 секунда
-- на кабинете с 88 артикулами. Общий снимок в базе видят все экземпляры.
create table if not exists public.ozon_cockpit_cache (
  cache_key text primary key,
  payload text not null,
  generated_at timestamptz not null default now()
);

create index if not exists ozon_cockpit_cache_generated_idx
  on public.ozon_cockpit_cache (generated_at desc);

alter table public.ozon_cockpit_cache enable row level security;
drop policy if exists "service role manages ozon cockpit cache" on public.ozon_cockpit_cache;
create policy "service role manages ozon cockpit cache"
  on public.ozon_cockpit_cache for all using (true) with check (true);
