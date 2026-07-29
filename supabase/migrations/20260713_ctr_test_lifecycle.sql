-- P1.3: кабинетный lifecycle CTR / CR / Video-тестов.
-- Живая перестановка контента намеренно выключена: раунд начинается только после
-- ручного подтверждения владельца, а метрики считаются по серверным WB-срезам.

alter table public.ctr_tests
  add column if not exists cabinet_id uuid references public.wb_cabinets(id) on delete cascade,
  add column if not exists test_type text not null default 'ctr',
  add column if not exists interval_min integer not null default 60,
  add column if not exists impressions_per_round integer not null default 350,
  add column if not exists target_impressions integer not null default 1000,
  add column if not exists spend_cap_rub numeric(14, 2) not null default 5000,
  add column if not exists live_swap_enabled boolean not null default false,
  add column if not exists round_num integer not null default 0,
  add column if not exists source_test_id bigint references public.ctr_tests(id) on delete set null,
  add column if not exists winner_explanation text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists created_by text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ctr_variants
  add column if not exists position integer not null default 0,
  add column if not exists is_baseline boolean not null default false,
  add column if not exists impressions bigint not null default 0,
  add column if not exists clicks bigint not null default 0,
  add column if not exists spend numeric(14, 2) not null default 0,
  add column if not exists opens bigint not null default 0,
  add column if not exists carts bigint not null default 0,
  add column if not exists orders bigint not null default 0,
  add column if not exists rounds_count integer not null default 0,
  add column if not exists rounds_won integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ctr_tests
  add column if not exists current_variant_id bigint references public.ctr_variants(id) on delete set null,
  add column if not exists winner_variant_id bigint references public.ctr_variants(id) on delete set null;

with ranked as (
  select id, row_number() over (partition by test_id order by created_at, id) - 1 as new_position
  from public.ctr_variants
)
update public.ctr_variants variant
set position = ranked.new_position,
    is_baseline = ranked.new_position = 0
from ranked
where variant.id = ranked.id;

create index if not exists ctr_tests_cabinet_created_idx
  on public.ctr_tests(cabinet_id, created_at desc) where cabinet_id is not null;
create unique index if not exists ctr_variants_test_position_unique
  on public.ctr_variants(test_id, position);

create table if not exists public.ctr_test_rounds (
  id            uuid primary key default gen_random_uuid(),
  test_id       bigint not null references public.ctr_tests(id) on delete cascade,
  variant_id    bigint not null references public.ctr_variants(id) on delete cascade,
  round_number  integer not null,
  status        text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  baseline      jsonb not null default '{}'::jsonb,
  result        jsonb not null default '{}'::jsonb,
  close_reason  text,
  actor         text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  unique(test_id, round_number)
);

create unique index if not exists ctr_test_one_active_round
  on public.ctr_test_rounds(test_id) where status = 'active';

create table if not exists public.ctr_test_events (
  id          bigint generated always as identity primary key,
  test_id     bigint not null references public.ctr_tests(id) on delete cascade,
  action      text not null,
  actor       text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ctr_test_events_test_created_idx
  on public.ctr_test_events(test_id, created_at desc);

alter table public.ctr_test_rounds enable row level security;
alter table public.ctr_test_events enable row level security;

-- Старые policy "all" раскрывали тесты между кабинетами через anon key.
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('ctr_tests', 'ctr_variants', 'ctr_test_rounds', 'ctr_test_events', 'cover_tests')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

revoke all on table public.ctr_tests, public.ctr_variants, public.ctr_test_rounds, public.ctr_test_events, public.cover_tests from anon, authenticated;
grant all on table public.ctr_tests, public.ctr_variants, public.ctr_test_rounds, public.ctr_test_events, public.cover_tests to service_role;

create or replace function public.create_ctr_test(p_test jsonb, p_actor text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_id bigint;
  v_cabinet_id uuid := nullif(p_test->>'cabinetId', '')::uuid;
  v_nm_id bigint := nullif(p_test->>'nmId', '')::bigint;
  v_type text := coalesce(nullif(p_test->>'testType', ''), 'ctr');
  v_variants jsonb := coalesce(p_test->'variants', '[]'::jsonb);
  v_scoped boolean := false;
  v_variant jsonb;
  v_position bigint;
begin
  if v_cabinet_id is null or v_nm_id is null or v_nm_id <= 0 then raise exception 'cabinetId and nmId are required'; end if;
  if v_type not in ('ctr', 'cr', 'video') then raise exception 'invalid test type'; end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) < 2 or jsonb_array_length(v_variants) > 6 then
    raise exception 'variants must contain 2..6 rows';
  end if;
  if exists (select 1 from jsonb_array_elements(v_variants) item where coalesce(item->>'imageUrl', '') !~ '^https://') then
    raise exception 'every variant needs an https imageUrl';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_variants) item
    group by item->>'imageUrl' having count(*) > 1
  ) then raise exception 'variant URLs must be unique'; end if;
  if coalesce((p_test->>'liveSwapEnabled')::boolean, false) then raise exception 'live swap is disabled'; end if;

  select cardinality(coalesce(brand_filters, '{}'::text[])) > 0
      or lower(coalesce(name, '') || ' ' || coalesce(trade_mark, '')) like '%optima%'
      or lower(coalesce(name, '') || ' ' || coalesce(trade_mark, '')) like '%оптима%'
    into v_scoped
  from public.wb_cabinets where id = v_cabinet_id and marketplace = 'wb';
  if not found then raise exception 'cabinet not found'; end if;
  if v_scoped and not exists (
    select 1 from public.wb_cabinet_product_scope scope
    where scope.cabinet_id = v_cabinet_id and scope.nm_id = v_nm_id
  ) then raise exception 'product is outside cabinet scope'; end if;
  if nullif(p_test->>'sourceTestId', '') is not null and not exists (
    select 1 from public.ctr_tests source
    where source.id = (p_test->>'sourceTestId')::bigint and source.cabinet_id = v_cabinet_id
  ) then raise exception 'source test is outside cabinet scope'; end if;

  insert into public.ctr_tests(
    cabinet_id, nm_id, article, name, status, test_type, interval_min,
    impressions_per_round, target_impressions, spend_cap_rub,
    live_swap_enabled, source_test_id, created_by
  ) values (
    v_cabinet_id,
    v_nm_id,
    left(coalesce(nullif(p_test->>'article', ''), v_nm_id::text), 255),
    left(coalesce(p_test->>'name', ''), 255),
    'draft',
    v_type,
    (p_test->>'intervalMin')::integer,
    (p_test->>'impressionsPerRound')::integer,
    (p_test->>'targetImpressions')::integer,
    (p_test->>'spendCapRub')::numeric,
    false,
    nullif(p_test->>'sourceTestId', '')::bigint,
    p_actor
  ) returning id into v_test_id;

  for v_variant, v_position in
    select item, ordinal - 1 from jsonb_array_elements(v_variants) with ordinality source(item, ordinal)
  loop
    insert into public.ctr_variants(test_id, label, image_url, source, is_baseline, position)
    values (
      v_test_id,
      left(coalesce(nullif(v_variant->>'label', ''), 'Вариант ' || chr(65 + v_position::integer)), 80),
      left(v_variant->>'imageUrl', 2000),
      left(coalesce(nullif(v_variant->>'source', ''), 'link'), 40),
      v_position = 0,
      v_position::integer
    );
  end loop;

  insert into public.ctr_test_events(test_id, action, actor, details)
  values (v_test_id, 'created', p_actor, jsonb_build_object('type', v_type, 'mode', 'manual'));
  return v_test_id;
end;
$$;

create or replace function public.transition_ctr_test(p_input jsonb, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.ctr_tests%rowtype;
  v_round public.ctr_test_rounds%rowtype;
  v_winner public.ctr_variants%rowtype;
  v_action text := coalesce(p_input->>'action', '');
  v_snapshot jsonb := coalesce(p_input->'snapshot', '{}'::jsonb);
  v_result jsonb := coalesce(p_input->'result', '{}'::jsonb);
  v_variant_id bigint := nullif(p_input->>'variantId', '')::bigint;
  v_total_spend numeric := 0;
  v_score numeric;
  v_explanation text;
  v_event_variant_id bigint;
begin
  select * into v_test from public.ctr_tests where id = (p_input->>'testId')::bigint for update;
  if not found or v_test.cabinet_id is null then raise exception 'test not found'; end if;
  if v_test.live_swap_enabled then raise exception 'live swap must remain disabled'; end if;

  if v_action = 'start' then
    if v_test.status not in ('draft', 'paused') then raise exception 'test cannot be started from current status'; end if;
    select coalesce(sum(spend), 0) into v_total_spend from public.ctr_variants where test_id = v_test.id;
    if v_total_spend >= v_test.spend_cap_rub then raise exception 'spend cap reached'; end if;
    if v_variant_id is null then
      select id into v_variant_id from public.ctr_variants where test_id = v_test.id order by position limit 1;
    end if;
    if not exists (select 1 from public.ctr_variants where id = v_variant_id and test_id = v_test.id) then raise exception 'variant not found'; end if;
    v_event_variant_id := v_variant_id;
    insert into public.ctr_test_rounds(test_id, variant_id, round_number, baseline, actor)
    values (v_test.id, v_variant_id, v_test.round_num + 1, v_snapshot, p_actor);
    update public.ctr_tests set status = 'running', current_variant_id = v_variant_id,
      round_num = round_num + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = v_test.id;

  elsif v_action in ('advance', 'pause', 'finish', 'cancel') then
    if v_test.status = 'running' then
      select * into v_round from public.ctr_test_rounds where test_id = v_test.id and status = 'active' for update;
      if not found then raise exception 'active round not found'; end if;
      v_event_variant_id := v_round.variant_id;
      update public.ctr_test_rounds set status = case when v_action = 'cancel' then 'cancelled' else 'closed' end,
        result = v_result, close_reason = v_action, ended_at = now()
      where id = v_round.id;
      update public.ctr_variants set
        impressions = impressions + coalesce((v_result->>'impressions')::bigint, 0),
        clicks = clicks + coalesce((v_result->>'clicks')::bigint, 0),
        spend = spend + coalesce((v_result->>'spend')::numeric, 0),
        opens = opens + coalesce((v_result->>'opens')::bigint, 0),
        carts = carts + coalesce((v_result->>'carts')::bigint, 0),
        orders = orders + coalesce((v_result->>'orders')::bigint, 0),
        rounds_count = rounds_count + 1,
        updated_at = now()
      where id = v_round.variant_id;

      select id into v_variant_id from public.ctr_variants where test_id = v_test.id
      order by case v_test.test_type
        when 'ctr' then clicks::numeric / nullif(impressions, 0)
        when 'cr' then carts::numeric / nullif(opens, 0)
        else orders::numeric / nullif(opens, 0)
      end desc nulls last, position asc limit 1;
      if v_variant_id is not null then
        update public.ctr_variants set rounds_won = rounds_won + 1, updated_at = now() where id = v_variant_id;
      end if;
    elsif v_action in ('advance', 'pause') then
      raise exception 'test is not running';
    end if;

    if v_action = 'advance' then
      select coalesce(sum(spend), 0) into v_total_spend from public.ctr_variants where test_id = v_test.id;
      if v_total_spend >= v_test.spend_cap_rub then
        update public.ctr_tests set status = 'paused', current_variant_id = null, updated_at = now() where id = v_test.id;
        v_action := 'cap_paused';
      else
        v_variant_id := nullif(p_input->>'variantId', '')::bigint;
        if v_variant_id is null then
          select id into v_variant_id from public.ctr_variants
          where test_id = v_test.id and position > (select position from public.ctr_variants where id = v_test.current_variant_id)
          order by position limit 1;
          if v_variant_id is null then select id into v_variant_id from public.ctr_variants where test_id = v_test.id order by position limit 1; end if;
        end if;
        if not exists (select 1 from public.ctr_variants where id = v_variant_id and test_id = v_test.id) then raise exception 'variant not found'; end if;
        v_event_variant_id := v_variant_id;
        insert into public.ctr_test_rounds(test_id, variant_id, round_number, baseline, actor)
        values (v_test.id, v_variant_id, v_test.round_num + 1, v_snapshot, p_actor);
        update public.ctr_tests set status = 'running', current_variant_id = v_variant_id,
          round_num = round_num + 1, updated_at = now() where id = v_test.id;
      end if;
    elsif v_action = 'pause' then
      update public.ctr_tests set status = 'paused', current_variant_id = null, updated_at = now() where id = v_test.id;
    elsif v_action = 'cancel' then
      update public.ctr_tests set status = 'cancelled', current_variant_id = null, finished_at = now(), updated_at = now() where id = v_test.id;
    elsif v_action = 'finish' then
      select * into v_winner from public.ctr_variants where test_id = v_test.id
      order by case v_test.test_type
        when 'ctr' then clicks::numeric / nullif(impressions, 0)
        when 'cr' then carts::numeric / nullif(opens, 0)
        else orders::numeric / nullif(opens, 0)
      end desc nulls last, rounds_won desc, position asc limit 1;
      if v_winner.id is null or (v_winner.impressions = 0 and v_winner.opens = 0) then raise exception 'not enough metrics to choose winner'; end if;
      v_score := case v_test.test_type when 'ctr' then v_winner.clicks::numeric / nullif(v_winner.impressions, 0) * 100 when 'cr' then v_winner.carts::numeric / nullif(v_winner.opens, 0) * 100 else v_winner.orders::numeric / nullif(v_winner.opens, 0) * 100 end;
      v_explanation := case v_test.test_type
        when 'ctr' then format('Лучший CTR %s%% по накопленным показам и кликам.', round(v_score, 2))
        when 'cr' then format('Лучшая конверсия в корзину %s%% по открытиям карточки.', round(v_score, 2))
        else format('Победитель по proxy-конверсии в заказ %s%%; WB API не отдаёт просмотры видео по вариантам.', round(v_score, 2))
      end;
      update public.ctr_variants set is_winner = id = v_winner.id, updated_at = now() where test_id = v_test.id;
      update public.ctr_tests set status = 'done', current_variant_id = null, winner_variant_id = v_winner.id,
        winner_explanation = v_explanation, finished_at = now(), updated_at = now() where id = v_test.id;
    end if;

  elsif v_action = 'winner' then
    if v_variant_id is null or not exists (select 1 from public.ctr_variants where id = v_variant_id and test_id = v_test.id) then raise exception 'variant not found'; end if;
    if v_test.status = 'running' then raise exception 'pause the test before choosing a winner'; end if;
    v_event_variant_id := v_variant_id;
    update public.ctr_variants set is_winner = id = v_variant_id, updated_at = now() where test_id = v_test.id;
    update public.ctr_tests set status = 'done', current_variant_id = null, winner_variant_id = v_variant_id,
      winner_explanation = left(coalesce(nullif(p_input->>'explanation', ''), 'Победитель выбран вручную владельцем.'), 2000),
      finished_at = now(), updated_at = now() where id = v_test.id;
  else
    raise exception 'unknown action';
  end if;

  insert into public.ctr_test_events(test_id, action, actor, details)
  values (v_test.id, v_action, p_actor, jsonb_build_object('variantId', v_event_variant_id, 'result', v_result));
  return (select to_jsonb(saved) from public.ctr_tests saved where saved.id = v_test.id);
end;
$$;

revoke all on function public.create_ctr_test(jsonb, text) from public;
revoke all on function public.transition_ctr_test(jsonb, text) from public;
grant execute on function public.create_ctr_test(jsonb, text) to service_role;
grant execute on function public.transition_ctr_test(jsonb, text) to service_role;
