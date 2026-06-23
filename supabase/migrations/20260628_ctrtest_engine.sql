-- CTR-тест на платном трафике (порт infernoff): ротация главного фото + замер CTR + победитель.
-- Аддитивно расширяет ctr_tests/ctr_variants. БЕЗОПАСНО: enabled=false; смена фото витрины — за
-- двойным гейтом (enabled + env CTRTEST_PHOTO_SWAP_LIVE); глобальный стоп — env CTRTEST_OFF=1.

alter table public.ctr_tests add column if not exists enabled boolean not null default false;
alter table public.ctr_tests add column if not exists interval_min int not null default 60;     -- ротация фото, мин
alter table public.ctr_tests add column if not exists min_impr int not null default 2000;       -- порог значимости
alter table public.ctr_tests add column if not exists impr_per_round int not null default 350;  -- цель показов на вариант/круг
alter table public.ctr_tests add column if not exists period_days int not null default 7;
alter table public.ctr_tests add column if not exists campaign_id bigint;                        -- служебная CPC-РК теста
alter table public.ctr_tests add column if not exists cur_variant_id bigint;
alter table public.ctr_tests add column if not exists cur_started_at timestamptz;
alter table public.ctr_tests add column if not exists winner_id bigint;
alter table public.ctr_tests add column if not exists started_at timestamptz;
alter table public.ctr_tests add column if not exists finished_at timestamptz;
alter table public.ctr_tests add column if not exists followup_at date;
alter table public.ctr_tests add column if not exists note text;

alter table public.ctr_variants add column if not exists views int not null default 0;
alter table public.ctr_variants add column if not exists clicks int not null default 0;
alter table public.ctr_variants add column if not exists ctr numeric;
alter table public.ctr_variants add column if not exists is_winner boolean not null default false;

-- Лог ротаций/действий теста (объяснимость + аудит).
create table if not exists public.ctr_test_log (
  id bigint generated always as identity primary key,
  test_id bigint not null,
  action text not null,         -- rotate | finish | swap | skip
  variant_id bigint,
  detail text,
  created_at timestamptz default now()
);
create index if not exists ctr_test_log_test on public.ctr_test_log (test_id, created_at);
alter table public.ctr_test_log enable row level security;
create policy "all" on public.ctr_test_log for all using (true) with check (true);
