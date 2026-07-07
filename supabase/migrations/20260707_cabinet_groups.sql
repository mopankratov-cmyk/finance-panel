-- Комбо-кабинеты: именованная группа из нескольких WB-кабинетов, выбираемая в
-- CabinetSwitcher одним пунктом (аналог "Joy+Опт" у infernoff.ru). member_ids —
-- массив uuid, ссылки на wb_cabinets.id не через FK (простой список, без каскада
-- на несколько строк) — при удалении кабинета группа просто перестанет находить
-- часть участников, это не критично для read-only агрегации.
create table if not exists public.cabinet_groups (
  id           bigint generated always as identity primary key,
  name         text not null,
  marketplace  text not null default 'wb',
  member_ids   uuid[] not null,
  created_at   timestamptz not null default now()
);

alter table public.cabinet_groups enable row level security;
create policy "all" on public.cabinet_groups for all using (true) with check (true);
