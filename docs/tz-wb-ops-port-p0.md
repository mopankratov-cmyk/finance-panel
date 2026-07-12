# ТЗ: порт WB-операционки на наш бэкенд (P0)

Автор: Claude (по итогам разбора infernoff.ru vs finance-panel). Дата: 2026-06-23.
Связанный документ: `docs/отложено.md` (ограничения официального API WB).

## 0. Контекст и принцип

Наша платформа и `infernoff.ru` Юры используют похожие контракты WB-операционки (совпадают имена эндпоинтов
`/api/sklejki`, `/api/ctrtest/*`, `/api/adverts/deposit`, `/api/unit/*`, `/api/design/effects`).
Наша реализация работает на Supabase и Next 16 и использует только поддерживаемые продуктовые модули.

**Принцип ТЗ: не изобретать, а портировать готовую логику Юры на наш бэкенд, максимально переиспользуя
существующее.** У нас уже есть БД-скелет под всё P0 — нужно дописать движки и UI, а не строить с нуля.

Что уже есть и переиспользуется:
- Формула маржи (фактовая, из отчёта WB): `lib/opiu/metrics.ts` (`aggregateWeek`) — revenue − cogs − комиссия − логистика − удержания − реклама.
- Себестоимость: `product_costs(entity, article, wb_barcode, cost_rub)`.
- Цены: `lib/wb/prices.ts` (`fetchWbCatalogPrices`) + экспорт XLSX `±5/10%` в `app/api/design/price-update/route.ts` (через `lib/xlsx/write.ts`).
- Таблицы: `agent_insights`, `card_changes`, `advert_bid_changes`, `ctr_tests`/`ctr_variants`, `wb_stocks`, `wb_funnel_daily`.
- Кроны: `vercel.json` + проверка `CRON_SECRET` (паттерн в `app/api/sync/all`).
- Гард денег: `apiGuard`/`proxyAuth` (`app/api/adverts/bid`, `app/api/costs`).

Правила работы (из AGENTS.md): не писать в `main`; ветка + PR на задачу; миграции/секреты/деньги → ручное
одобрение владельца через AI-гейт; не делать попутных широких рефакторингов.

---

## P0-1. Репрайсер как rule-engine

**Зачем.** Сейчас у нас только экспорт XLSX с плоским `±5/10%` — без стратегий, условий и автопрогона.
Это наш главный функциональный долг. Портируем движок правил Юры.

**Модель данных (новая миграция `YYYYMMDD_repricer.sql`):**
```sql
create table if not exists public.repricer_strategies (
  id bigint generated always as identity primary key,
  name text not null,
  action text not null,              -- dec_pct | inc_pct
  amount numeric not null,           -- % шага
  margin_floor numeric not null default 15,
  conditions jsonb not null,         -- [{metric, op, value}] метрики: gmroi|stock|drr|turnover|margin
  enabled boolean not null default true,
  created_at timestamptz default now()
);
create table if not exists public.repricer_decisions (
  id bigint generated always as identity primary key,
  run_date date not null,
  cabinet text not null,
  nm_id bigint not null,
  article text,
  strategy_id bigint references public.repricer_strategies(id),
  strategy_name text,
  old_price numeric,
  new_price numeric,
  metrics jsonb,                     -- снимок ctr/drr/gmroi/margin/stock/turnover
  used jsonb,                        -- какие условия сработали (для объяснимости)
  status text not null default 'proposed', -- proposed | skipped | exported | applied
  created_at timestamptz default now()
);
create index if not exists repricer_decisions_run on public.repricer_decisions (run_date, cabinet);
```
Сид-стратегии (как у Юры, все `margin_floor 15`):
| name | action | amount | conditions (AND) |
|---|---|---|---|
| Разгон GMROI | dec_pct | 5 | gmroi<200, stock>50, drr>5, turnover>50 |
| Рост маржи | inc_pct | 5 | gmroi>200, stock>50 |
| Скоро аут | inc_pct | 10 | gmroi>200, stock<50 |
| ДРР позволяет | inc_pct | 5 | drr<5, gmroi>150 |

**Логика (`lib/repricer/evaluate.ts`):**
1. Собрать на SKU метрики «за вчера»: ctr/drr/gmroi/margin/stock/turnover (из `wb_funnel_daily` + `wb_stocks` + `lib/opiu` + reuse расчётов RnP `lib/rnp/buildRnp.ts`).
2. Для каждой включённой стратегии проверить все `conditions` (первая сработавшая по приоритету выигрывает).
3. Посчитать `new_price = old_price × (1 ± amount/100)`, но **не ниже** цены, дающей `margin_floor` (использовать решатель из P0-2).
4. Записать decision с `used` (объяснимость) или `status='skipped'`.

**API:**
- `GET /api/repricer/state` — стратегии + назначения.
- `GET /api/repricer/decisions?date=&cabinet=` — решения прогона.
- `POST /api/repricer/run` — прогнать сейчас (запись decisions). **`apiGuard` (деньги/цены).**
- `POST /api/repricer/strategy` — CRUD стратегий. **`apiGuard`.**
- `GET /api/repricer/export?cabinet=&date=` — XLSX «Новые цены» из decisions (reuse `lib/xlsx/write.ts`).

**Cron:** `vercel.json` → `{ "path": "/api/repricer/run/cron", "schedule": "0 6 * * *" }` (после `sync/all` в 6:00). Проверка `CRON_SECRET`.

**UI:** страница `app/repricer/` — таблица SKU (метрики + назначенная стратегия + предложенная цена), редактор стратегий, кнопки «Прогнать», «Скачать XLSX по кабинету». Цвет: зелёная цена выросла, красная упала.

**Применение цен:** на старте — **human-in-the-loop** (как у Юры): отдаём XLSX, владелец заливает. Авто-push через `POST /api/v2/upload/task` — отдельная задача P1, требует токен с правом записи цен.

**Acceptance:**
- Прогон создаёт `repricer_decisions` за дату; каждое решение объяснимо (`used`).
- Ни одна `new_price` не опускает маржу ниже `margin_floor`.
- XLSX совпадает по формату с текущим `design/price-update` (UI не ломается).

---

## P0-2. Обратный решатель цены (target-margin)

**Зачем.** У Юры в Unit есть «цена для 15/25/35% маржи + дельта». У нас весь стек затрат уже считается
(`lib/opiu`), но решателя в UI нет. Дёшево, и он напрямую кормит `margin_floor` репрайсера. **Миграции не нужно.**

**Логика (`lib/unit/priceSolver.ts`):**
- Вход: nm/article, целевая маржа `m` (доля).
- Берём фиксированные на единицу затраты из фактовых данных WB-отчёта (комиссия %, логистика ₽/шт, хранение ₽/шт, эквайринг %, налог %) + `cogs` из `product_costs`.
- Решаем относительно цены после СПП: `price_after = (cogs + fixed_rub) / (1 − m − pct_fees)`, затем `price_before = price_after / (1 − spp)`.
- Возвращаем `{ targets: [{margin, price_before, price_after, delta_pct_vs_current}] }` для m ∈ {15,25,35%} (+ произвольное).

**API:** `GET /api/unit/price-solver?nm=&cabinet=&margins=15,25,35`.

**UI:** колонка/панель в существующем `app/costs` или `app/unit` — «нужная цена под маржу + дельта от текущей».

**Acceptance:**
- При подстановке `price_after` обратно в `lib/opiu` маржа = целевой (±0.5 п.п.).
- Дельта считается от текущей каталожной цены (`fetchWbCatalogPrices`).
- Используется репрайсером (P0-1) как источник `margin_floor`-цены.

---

## P0-3. Движок сигналов «узкое место»

**Зачем.** У нас `agent_insights` пустует, сигнал — тривиальный «Без трафика». Портируем классификатор Юры.
**Миграции не нужно** — пишем в существующий `agent_insights`.

**Логика (`lib/signals/classify.ts`)** — на SKU за вчера, по приоритету:
| сигнал | условие | вывод |
|---|---|---|
| Остатки | stock < порог дней | дозаказ/поставка |
| Реклама | показы малы при активной РК | поднять ставку/ключи |
| Контент | трафик есть (показы>порог), но корзина<X% и заказ<Y% | переделать главное фото |
| Конкуренты | клик норм, но маржа до ДРР < 25% | цена/сезон |
| ДРР | drr высокий, маржа после ДРР мала | резать ставки |
| Маржа | маржа до ДРР ниже целевой | пересмотр цены (→ решатель P0-2) |
| OK | ничего не сработало | — |

Пороги вынести в `lib/signals/thresholds.ts` (по категориям, как бенчмарки воронки Юры: Ковры 6/8/15, Сумки 6/12/20…).

**Запись:** `agent_insights(module='wb_signal', severity, title=<тип>, body=<объяснение+рекомендация>, data={nm, article, cabinet, metrics})`. Идемпотентно за день (по nm+date в `data`).

**API:** `GET /api/seo/skus` уже отдаёт `signal_yesterday` — добавить туда поле; либо `GET /api/signals?cabinet=`.
**Cron:** включить в `/api/repricer/run/cron` (те же метрики) или отдельным шагом после `sync/all`.

**UI:** колонка «Сигнал» в РНП/воронке/seo-таблицах + лента в `agent` (insights).

**Acceptance:** у каждого живого SKU за вчера ровно один сигнал; объяснение содержит конкретную рекомендацию.

---

## P1 (после P0) — спецификация позже

> **Разблокировано:** write-токен рекламы WB у владельца есть. Нужно только прописать его в env (Vercel)
> вместо текущего read-only `WB_TOKEN_ADVERT` (env-изменение → владельцу через AI-гейт). После свапа P1 рабочее.

- **Авто-докидывание рекламы (крон).** Конфиг на кампанию (`enabled, hours[], amount_rub, threshold_rub`), крон по окнам: `budget<threshold → deposit + релонч`. Код депозита уже есть (`app/api/adverts/deposit`) — оживёт сразу после свапа токена.
- **CTR-тест на платном трафике.** Расширить `ctr_tests`/`ctr_variants`: выделенная CPC-кампания, ~350 показов/вариант, ротация фото 60 мин, победитель по CTR + followup «держится/просела». Нужны write-токен (есть) + Content API media/save (смена главного фото).
- **Headless-скрейп кабинета** для масштаба РК и дневных метрик вне API.

## P2 — добить начатое
- Поставки: реальная WMS-интеграция (МойСклад) + паллетная раскладка (заменить заглушку `supplies/wms-ready`).
- Воронка: бенчмарки по категориям + хитмап + замер эффекта правок (`card_changes` уже есть → before/after как `design/effects`).
- SEO: дневной ряд позиций (если решим скрейпить).

---

## Порядок работ (что буду делать)

Каждая задача — отдельная ветка + PR. Миграции уходят владельцу на ручное одобрение через AI-гейт.

1. **P0-2 решатель цены** — `feat/unit-price-solver`. Без миграции, чистый расчёт + 1 read-роут + UI-колонка. Самый дешёвый и разблокирует P0-1.
2. **P0-3 сигналы** — `feat/wb-signals`. Без миграции (пишем в `agent_insights`). Классификатор + пороги + вывод в существующие таблицы.
3. **P0-1 репрайсер** — `feat/wb-repricer`. Миграция (`repricer_strategies/decisions`) → владельцу. Затем движок + роуты + cron + страница + XLSX-экспорт.

После каждого PR: `npm run dev` поднимается без ошибок, локальная проверка флоу. P1 специфицирую отдельным ТЗ, когда будет write-токен рекламы.

## Риски / открытые вопросы
- **Write-токен рекламы WB** — ✅ есть у владельца. Действие: прописать в env вместо read-only `WB_TOKEN_ADVERT` (через AI-гейт). После этого P1 разблокирован; до этого write-роуты рекламы дают 401.
- **Авто-push цен** vs human-in-the-loop XLSX — на старте оставляю XLSX (безопаснее, как у Юры). При желании авто-push цен через `POST /api/v2/upload/task` — отдельная задача (нужен токен с правом «Цены и скидки»).
- Точные пороги сигналов/бенчмарки — взять стартовые от Юры, потом калибровать на наших данных.
- Метрика `turnover`/`gmroi` per-SKU — убедиться, что считается из наших таблиц так же, как в RnP (свериться с `lib/rnp/buildRnp.ts`).
