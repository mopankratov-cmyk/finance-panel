-- Фаза A методологии CTR-тестов (ТЗ владельца 15.09.2026): тест должен
-- измеряться по ОДНОЙ поисковой кампании, а не по сумме всех кампаний и
-- полок на артикул разом (как сейчас). advert_id — эта кампания, резолвится
-- один раз при первом запуске теста и больше не меняется (см.
-- lib/ctrtest/campaignBinding.ts: пока round_num = 0).
--
-- shelf_conflict_state и ctr_test_shelf_pauses — учёт конкурирующих
-- «полочных» кампаний на этом же артикуле: пауза только с явным
-- подтверждением человека (владелец подтвердил 15.09.2026, молча — нельзя),
-- автовозврат — только того, что поставил на паузу сам тест.

alter table public.ctr_tests
  add column if not exists advert_id bigint,
  add column if not exists shelf_conflict_state text not null default 'unchecked'
    check (shelf_conflict_state in ('unchecked', 'none', 'pending', 'confirmed', 'declined')),
  add column if not exists shelf_conflict_checked_at timestamptz,
  add column if not exists shelf_conflict_resolved_by text;

comment on column public.ctr_tests.advert_id is
  'Поисковая кампания (cpc_search/cpm_search), к которой привязана метрика теста. NULL — тест ещё не запускался, кампания не резолвится однозначно, либо тест старше этой миграции.';
comment on column public.ctr_tests.shelf_conflict_state is
  'unchecked — детект ещё не запускался; none — конкурирующих полочных кампаний на этом артикуле нет; pending — найдены, ждут решения человека; confirmed — подтвердил паузу; declined — осознанно продолжил без паузы.';

create table if not exists public.ctr_test_shelf_pauses (
  id            bigint generated always as identity primary key,
  test_id       bigint not null references public.ctr_tests(id) on delete cascade,
  cabinet_id    uuid not null references public.wb_cabinets(id) on delete cascade,
  advert_id     bigint not null,
  advert_name   text,
  block         text,
  status_before int,
  paused_at     timestamptz not null default now(),
  paused_by     text,
  resumed_at    timestamptz,
  resumed_by    text,
  resume_error  text,
  unique (test_id, advert_id)
);

comment on table public.ctr_test_shelf_pauses is
  'Какие полочные кампании поставил на паузу конкретный CTR-тест — чтобы при завершении вернуть ровно их, а не то, что владелец мог выключить сам ещё до теста.';

create index if not exists ctr_test_shelf_pauses_open_idx
  on public.ctr_test_shelf_pauses (test_id) where resumed_at is null;

alter table public.ctr_test_shelf_pauses enable row level security;
revoke all on table public.ctr_test_shelf_pauses from anon, authenticated;
grant all on table public.ctr_test_shelf_pauses to service_role;
