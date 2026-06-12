# ТЗ: Система управления WB-бизнесом «по образцу Inferno»

Версия 1.0 · база: существующий проект finance-panel (Next.js 16 + Supabase + Recharts)

---

## 1. Что строим

Единая платформа управления маркетплейс-бизнесом, где каждый модуль — отдельная зона ответственности («агент»). Пользователь видит главную страницу с карточками модулей, заходит в нужный и работает с живыми данными WB.

### Модули (приоритет сверху вниз)

| # | Модуль | Статус у тебя | Что внутри |
|---|--------|---------------|------------|
| 1 | Финансы | ✅ готов | Календарь ДДС, платежи, счета, кредиты, ОПиУ |
| 2 | WB Аналитика | ⚠️ частично | РНП, воронка, остатки, оборачиваемость, GMROI, ДРР |
| 3 | Реклама | ❌ нет | Кампании, ставки, CTR/CPC, анализ ДРР, расписание |
| 4 | Закупки | ❌ нет | План поставок по складам, остатки, мин. партии, тара |
| 5 | Юнит-экономика | ❌ нет | Калькулятор цены, маржа, себестоимость по SKU |
| 6 | AI-агент | ❌ нет | Claude анализирует данные, находит аномалии, советует |
| 7 | Контент-лаборатория | 🔮 потом | AI-генерация фото карточек, A/B тесты CTR |

---

## 2. Архитектура

```
┌─────────────────────────────────────────────────┐
│  Next.js (Vercel) — фронт + API routes          │
│  /            главная с карточками модулей      │
│  /calendar /payments /opiu ... (есть)           │
│  /analytics/* (есть, расширяем)                 │
│  /ads /supplies /unit (новые)                   │
│  /api/sync/*  серверные синки WB → Supabase     │
│  /api/agent   Claude AI анализ                  │
├─────────────────────────────────────────────────┤
│  Supabase (Postgres) — единое хранилище          │
│  + Row Level Security, + Realtime при желании    │
├─────────────────────────────────────────────────┤
│  Vercel Cron — расписание синков                 │
│  (опц.) VPS-worker для тяжёлых задач             │
└─────────────────────────────────────────────────┘
        │              │               │
   WB Statistics   WB Adv API     WB Content API
   (заказы/продажи) (реклама)     (карточки/фото)
```

### Ключевое отличие от Inferno (в лучшую сторону)

| У них | У нас |
|-------|-------|
| Статический HTML + vanilla JS | Next.js + React + TypeScript — переиспользуемые компоненты |
| Google Sheets как БД | Supabase Postgres — индексы, связи, скорость |
| Headless Chromium скрейпит кабинет | Официальные WB API (надёжнее; скрейпинг — только если API не хватит) |
| Свой VPS с кронами | Vercel Cron (бесплатно до 2 заданий, дальше — VPS-worker) |

---

## 3. База данных (Supabase)

Новые таблицы (к существующим accounts/payments/loans):

```sql
-- Кэш данных WB, обновляется кроном
create table wb_orders (
  id bigint generated always as identity primary key,
  srid text unique,              -- ID заказа WB
  nm_id bigint not null,         -- артикул WB
  supplier_article text,
  date timestamptz not null,
  total_price numeric,
  discount_percent numeric,
  finished_price numeric,
  is_cancel boolean default false,
  warehouse text,
  region text,
  synced_at timestamptz default now()
);
create index on wb_orders (nm_id, date);

create table wb_sales (
  id bigint generated always as identity primary key,
  sale_id text unique,
  nm_id bigint not null,
  date timestamptz not null,
  for_pay numeric,               -- к перечислению
  finished_price numeric,
  synced_at timestamptz default now()
);

create table wb_stocks (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  warehouse text not null,
  quantity int,
  in_way_to_client int,
  in_way_from_client int,
  synced_at timestamptz default now(),
  unique (nm_id, warehouse)
);

create table wb_adverts (
  id bigint generated always as identity primary key,
  advert_id bigint unique,
  name text,
  type int,                      -- тип кампании WB
  status int,
  daily_budget numeric,
  synced_at timestamptz default now()
);

create table wb_advert_stats (
  id bigint generated always as identity primary key,
  advert_id bigint not null,
  date date not null,
  views int, clicks int, ctr numeric,
  cpc numeric, sum_spent numeric,
  orders int, sum_orders numeric,
  unique (advert_id, date)
);

create table wb_funnel_daily (         -- воронка по SKU по дням
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  date date not null,
  open_card int,                 -- показы карточки
  add_to_cart int,
  orders int,
  orders_sum numeric,
  buyouts int,
  buyout_sum numeric,
  unique (nm_id, date)
);

create table product_costs (           -- себестоимость (уже есть hooks/useProductCosts)
  nm_id bigint primary key,
  supplier_article text,
  cost numeric not null,
  category text,
  updated_at timestamptz default now()
);

create table sync_log (                -- журнал синхронизаций
  id bigint generated always as identity primary key,
  job text not null,             -- 'orders' | 'sales' | 'stocks' | 'adverts' | 'funnel'
  status text not null,          -- 'ok' | 'error'
  rows_affected int,
  error text,
  started_at timestamptz,
  finished_at timestamptz default now()
);

create table agent_insights (          -- выводы AI-агента
  id bigint generated always as identity primary key,
  module text not null,          -- 'ads' | 'finance' | 'supplies' ...
  severity text not null,        -- 'info' | 'warning' | 'critical'
  title text not null,
  body text not null,
  data jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);
```

---

## 4. Синхронизация WB → Supabase

### API-роуты (Next.js route handlers)

| Роут | Что делает | WB endpoint | Частота |
|------|-----------|-------------|---------|
| `/api/sync/orders` | Заказы за N дней, upsert по srid | statistics-api `/api/v1/supplier/orders` | 30 мин |
| `/api/sync/sales` | Продажи/выкупы | `/api/v1/supplier/sales` | 30 мин |
| `/api/sync/stocks` | Остатки по складам | `/api/v1/supplier/stocks` | 1 час |
| `/api/sync/adverts` | Список кампаний + статусы | advert-api `/adv/v1/promotion/count`, `/adv/v1/promotion/adverts` | 1 час |
| `/api/sync/advert-stats` | Статистика кампаний по дням | `/adv/v2/fullstats` | 1 час |
| `/api/sync/funnel` | Воронка по SKU (показы→корзина→заказ) | analytics `/api/v2/nm-report/detail` | 2 часа |

Правила реализации:
- Все роуты защищены секретом: `Authorization: Bearer ${CRON_SECRET}` — иначе любой сможет дёргать.
- Идемпотентность: upsert по уникальному ключу, повторный запуск не дублирует.
- Rate limits WB: statistics 1 req/min на метод — ставить паузы и хранить курсор `dateFrom = max(date) из таблицы`.
- Каждый запуск пишет строку в `sync_log` (успех/ошибка/кол-во строк).
- Токены WB в env: `WB_STATS_TOKEN`, `WB_ADV_TOKEN`, `WB_CONTENT_TOKEN` (у WB разные токены на разные API).

### Vercel Cron (vercel.json)

```json
{
  "crons": [
    { "path": "/api/sync/orders",  "schedule": "*/30 * * * *" },
    { "path": "/api/sync/funnel",  "schedule": "0 */2 * * *" }
  ]
}
```
Hobby-план Vercel даёт 2 cron-задания с дневной частотой; Pro — больше и чаще. Если упрёмся в лимит — один роут `/api/sync/all`, который последовательно гоняет все синки, либо дешёвый VPS (~300₽/мес) с обычным crontab + curl.

---

## 5. Модули фронтенда

### 5.1 Главная страница (редизайн `/`)

Как у Inferno: hero «Система управления WB», сетка карточек модулей. Каждая карточка: иконка, название, статус (активен / скоро), описание, имя «агента» (опционально, для духа системы). Карточки-ссылки на разделы. Тёмная тема в стиле текущего сайдбара (#1a1a2e, violet акценты).

### 5.2 РНП (отчёт-навигатор-продаж) — `/analytics/rnp` (новая)

Таблица по SKU с периодами (сегодня/вчера/неделя/месяц/прошлый месяц):
- Заказы шт/₽, выкупы, остатки, оборачиваемость (остаток ÷ ср.дневные заказы), GMROI, ДРР, «деньги в остатках» (остаток × себес).
- Сортировка кликом по колонке, цветовая индикация против бенчмарков.
- Данные: `wb_orders + wb_stocks + wb_advert_stats + product_costs` — всё уже в Supabase, считаем на сервере.

### 5.3 Воронка — расширение `/analytics/sales`

По каждому SKU: Показы → Клики (CTR) → Корзины (CV) → Заказы (CR) → Выкупы.
- Бенчмарки по категориям (редактируемые): фон ячейки 🟢 ≥ бенча, 🟡 80–99 %, 🔴 < 80 %.
- Переключатель периода 7 дней / вчера.
- Источник: `wb_funnel_daily`.

### 5.4 Реклама — `/ads` (новая)

- Список кампаний (название, тип, статус, бюджет, расход сегодня).
- Карточка кампании: график CTR/CPC/расход по дням, ДРР = расход ÷ заказы ₽.
- Таблица «Анализ рекламы»: товар, показы, расход, CTR, CPC, ДРР, остаток — с фильтром по CTR.
- v2: управление ставками через Adv API (пауза/запуск кампании, изменение ставки).

### 5.5 Закупки/Поставки — `/supplies` (новая)

- Сводка остатков по складам WB (из `wb_stocks`).
- Расчёт потребности: ср. дневные заказы × горизонт (30/45/60 дней) − остаток − в пути = к поставке.
- Минимальная партия, группировка по складам (отгружаем склад только если ≥ 1 паллеты — как у них).
- Импорт «готовой тары» из Excel (xlsx upload → парсинг).

### 5.6 Юнит-экономика — `/unit` (новая)

Калькулятор цены (две стороны):
- «Цена → маржа»: вводишь цену до СПП, получаешь маржу.
- «Цель маржа → цена»: вводишь целевую маржу, получаешь нужную цену.
- Параметры: себестоимость (из `product_costs`), комиссия WB % (дефолт по категории), налог %, ДРР %, эквайринг %.
- Выбор артикула автоподставляет себес и категорию.
- Таблица «Unit fact неделя»: фактическая маржа по SKU за неделю из реальных данных.

### 5.7 AI-агент — `/agent` + виджет на всех страницах

- Роут `/api/agent`: собирает срез данных из Supabase (продажи, ДРР, остатки, кассовые разрывы) → Claude API → структурированный ответ.
- Сценарии:
  - «Ежедневный разбор»: cron утром → агент анализирует вчера → пишет insights в `agent_insights` → бейдж на главной.
  - Аномалии: ДРР вырос ×2, CTR упал ниже бенча, остаток < 14 дней, кассовый разрыв через N дней.
  - Чат: вопрос свободной формой → агент отвечает по данным.
- Модель: claude-sonnet-4-6 через API, ключ в env.

---

## 6. Этапы и порядок работ

| Этап | Состав | Результат |
|------|--------|-----------|
| 1 | Таблицы Supabase + `/api/sync/orders`, `/sales`, `/stocks` + sync_log | Данные WB лежат в своей БД |
| 2 | РНП страница + редизайн главной | Видно бизнес одним взглядом |
| 3 | `/api/sync/funnel` + воронка с бенчмарками | Понимание конверсий по SKU |
| 4 | `/api/sync/adverts` + `/ads` модуль | Контроль рекламы и ДРР |
| 5 | Vercel Cron + журнал синков в UI | Всё обновляется само |
| 6 | `/supplies` + `/unit` | Закупки и ценообразование |
| 7 | AI-агент (анализ + инсайты + чат) | Система «думает» сама |
| 8 | (v2) Контент-лаборатория, A/B CTR-тесты | Как у них, но позже |

Каждый этап — рабочий результат, можно останавливаться где угодно.

---

## 7. Env-переменные

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # для серверных upsert
WB_STATS_TOKEN=                 # токен «Статистика»
WB_ADV_TOKEN=                   # токен «Продвижение»
WB_CONTENT_TOKEN=               # токен «Контент» (этап 8)
CRON_SECRET=                    # защита sync-роутов
ANTHROPIC_API_KEY=              # AI-агент (этап 7)
```

## 8. Риски и ограничения

- **Лимиты WB API** — statistics: 1 запрос/мин на метод. Решение: инкрементальные курсоры, очередь, ретраи с backoff.
- **Vercel timeout** — serverless функции до 10–60 сек. Тяжёлые синки бить на страницы (pagination), либо VPS-worker.
- **Vercel Cron на Hobby** — мало слотов. Решение: единый `/api/sync/all` или внешний пинг (cron-job.org бесплатно).
- **Рекламный кабинет**: часть данных (как у Inferno через Chromium) нет в API. На старте берём только официальные API — этого хватает на 90 %.
