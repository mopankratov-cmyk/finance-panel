-- WB data reliability: cabinet-bound advert audit, persistent cursors and token health.

alter table public.wb_adverts
  add column if not exists bid_cpm_rub numeric,
  add column if not exists last_stats_synced_at timestamptz;

-- До этой миграции daily_budget фактически содержал CPM. Переносим значение в
-- правильное поле и освобождаем daily_budget для настоящего дневного бюджета.
update public.wb_adverts
set bid_cpm_rub = coalesce(bid_cpm_rub, daily_budget),
    daily_budget = null
where daily_budget is not null;

alter table public.advert_bid_changes
  add column if not exists cabinet_id uuid references public.wb_cabinets(id) on delete set null,
  add column if not exists user_id text,
  add column if not exists user_email text,
  add column if not exists action text,
  add column if not exists old_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists wb_result jsonb;

create index if not exists advert_bid_changes_cabinet_created_idx
  on public.advert_bid_changes (cabinet_id, created_at desc);

drop policy if exists "all" on public.advert_bid_changes;
revoke all on table public.advert_bid_changes from anon, authenticated;

create table if not exists public.wb_token_health (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  scope text not null,
  available boolean,
  expires_at timestamptz,
  days_left integer,
  checked_at timestamptz not null default now(),
  last_error text,
  primary key (cabinet_id, scope)
);

create index if not exists wb_token_health_checked_idx
  on public.wb_token_health (checked_at desc);

alter table public.wb_token_health enable row level security;
revoke all on table public.wb_token_health from anon, authenticated;

-- Атомарная блокировка задания. Зависший running старше указанного времени
-- автоматически разрешается перехватить следующему запуску (watchdog).
create or replace function public.claim_wb_sync_job(
  p_cabinet_id uuid,
  p_job text,
  p_stale_after_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean := false;
begin
  insert into public.wb_sync_state (cabinet_id, job, status, attempts, state, updated_at)
  values (p_cabinet_id, p_job, 'running', 0, '{}'::jsonb, now())
  on conflict (cabinet_id, job) do update
  set status = 'running',
      last_error = null,
      updated_at = now()
  where public.wb_sync_state.status <> 'running'
     or public.wb_sync_state.updated_at < now() - make_interval(secs => greatest(60, p_stale_after_seconds))
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_wb_sync_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_wb_sync_job(uuid, text, integer) to service_role;
