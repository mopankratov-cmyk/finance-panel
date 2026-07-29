-- Отзывы покупателей WB (Feedbacks & Questions API, feedbacks-api.wildberries.ru).
-- cabinet_id NOT NULL + on delete cascade — как в сегодняшних wb_nm_commissions/
-- purchase_receipts, а не в nullable-легаси wb_orders/wb_stocks (тот родом из июня,
-- до мультикабинета). wb_feedbacks — новая таблица без легаси, синк идёт по
-- getActiveWbCabinets() напрямую (без ENV-фолбэка) — нет кабинетов в БД → 0 строк.
--
-- id — собственный строковый id отзыва WB (глобально уникален) — PK напрямую;
-- апсёрт по нему идемпотентен и переживает смену is_answered/answer_text на уже
-- увиденном отзыве.
--
-- Стратегия наполнения (см. app/api/sync/feedbacks/route.ts): isAnswered=false тянем
-- полностью (открытый бэклог), isAnswered=true — только последние ~35 дней (запас
-- над 30-дневным окном KPI), с ранним выходом по дате.

create table if not exists public.wb_feedbacks (
  id            text primary key,
  cabinet_id    uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id         bigint not null,
  imt_id        bigint,
  article       text not null default '',
  brand_name    text,
  product_name  text,
  rating        smallint not null check (rating between 1 and 5),
  review_text   text,
  pros          text,
  cons          text,
  photos        jsonb not null default '[]'::jsonb,
  has_video     boolean not null default false,
  is_answered   boolean not null default false,
  answer_text   text,
  created_at_wb timestamptz not null,
  synced_at     timestamptz not null default now()
);

create index if not exists wb_feedbacks_cabinet_idx    on public.wb_feedbacks (cabinet_id);
create index if not exists wb_feedbacks_nm_idx         on public.wb_feedbacks (nm_id);
create index if not exists wb_feedbacks_created_idx    on public.wb_feedbacks (cabinet_id, created_at_wb desc);
create index if not exists wb_feedbacks_unanswered_idx on public.wb_feedbacks (cabinet_id, created_at_wb desc) where is_answered = false;

alter table public.wb_feedbacks enable row level security;
create policy "all" on public.wb_feedbacks for all using (true) with check (true);
