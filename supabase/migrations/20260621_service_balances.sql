-- Балансы платных сервисов завода: снимки остатка + пороги предупреждения.
-- Цель: одно место «сколько бабок осталось» по каждому сервису + история/тренд + алерт когда мало.
-- Идемпотентно. Применять в Supabase SQL Editor. Эндпоинты деградируют мягко, если таблицы нет (try/catch).

-- ── Снимки баланса: КАЖДЫЙ снимок = строка → отсюда тренд/спарклайн и история трат ──────────────
-- balance — число в единицах сервиса (USD у virlo/fal/anthropic; credits у creatify/shotstack).
-- source — откуда взято: api (живой опрос), manual (владелец ввёл руками), estimated (оценка по журналу).
create table if not exists service_balances (
  id           bigint generated always as identity primary key,
  service      text not null,                       -- virlo|creatify|fal|shotstack|anthropic
  balance      numeric,                             -- остаток в единицах валюты сервиса
  currency     text,                                -- 'USD' | 'credits'
  raw          jsonb,                               -- сырой ответ API (для отладки/доп-полей)
  source       text not null default 'api',         -- api|manual|estimated
  snapshot_at  timestamptz not null default now()
);
-- последний снимок и история по сервису
create index if not exists service_balances_service_idx on service_balances(service, snapshot_at desc);

-- ── Пороги предупреждения (1 строка на сервис, задаёт владелец) ──────────────────────────────────
-- threshold — в тех же единицах, что и баланс сервиса. balance <= threshold → красный бейдж + алерт.
-- alerted_at — антидребезг: не шлём повторный алерт чаще, чем раз в сутки.
create table if not exists service_thresholds (
  service     text primary key,                     -- virlo|creatify|fal|shotstack|anthropic
  threshold   numeric,                              -- порог «мало денег» (NULL = не следим)
  notes       text,                                 -- заметка владельца (напр. «admin-key в Vercel»)
  alerted_at  timestamptz,                          -- когда последний раз слали алерт (debounce)
  updated_at  timestamptz not null default now()
);
