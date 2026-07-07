# Структура репозитория — Финансы МП

> Панель управления маркетплейсами **Wildberries + Ozon** на Next.js 16 (App Router).
> Русскоязычный интерфейс, мультикабинетность, данные на цене до СПП, AI-агент на Claude.
>
> Контент-завод (видео/фото-генерация) вынесен в отдельный репозиторий **content-factory** — здесь его нет.

---

## Стек

| Слой | Технология |
|------|-----------|
| Фреймворк | Next.js 16.2.7 (App Router) |
| UI | React 19 · Tailwind 4 · Lucide · Recharts |
| БД | Supabase (PostgreSQL) |
| Авторизация | JWT (jose, HS256) · bcryptjs · RBAC |
| AI | Anthropic Claude SDK (агент + инсайты) |
| Язык | TypeScript 5 |
| Деплой | Vercel (`finance-panel-two.vercel.app`, ручной `vercel --prod`) |
| CI | Gitea Actions — двухуровневый AI-гейт (`.gitea/workflows/ai-gate.yml`) |

---

## Продуктовые зоны (навигация Sidebar)

| Зона | Страницы |
|------|----------|
| **Аналитика МП** | `/adverts` реклама WB · `/rnp` РНП · `/seo` воронка · `/sklejki` · `/unit` юнит · `/ctrtest` CTR · `/planning` · `/ozon` · `/abc` · `/trends` · `/market` |
| **Финрезультат** | `/pnl` ОПиУ WB+Ozon · `/opiu` недельный P&L WB · `/losses` где теряем · `/summary` сводка |
| **Деньги (ДДС)** | `/calendar` · `/payments` (+импорт ДДС) · `/accounts` · `/loans` |
| **Операции** | `/supplies` закупки · `/costs` себес · `/repricer` · `/price-solver` · `/sync` |
| **Система** | `/cabinets` · `/users` · `/agent` AI-агент · `/login` |

Инструменты вне сайдбара (доступ по URL через role-allowlist): `/card-editor`, `/uniquizer`.

---

## Дерево каталогов

```
/
├── app/
│   ├── layout.tsx · page.tsx        # корневой layout + дашборд (ModulesHome)
│   ├── <зона>/page.tsx              # страницы-шлюзы на компоненты (см. таблицу зон)
│   └── api/
│       ├── auth/                    # login · logout · me · status (JWT, bcrypt)
│       ├── agent/                   # AI-агент: чат + insights
│       ├── opiu/                    # P&L: mp/ (WB+Ozon), warehouse/
│       ├── wb/ · ozon/              # аналитика WB / Ozon (losses и т.д.)
│       ├── adverts/                 # рекламный кабинет WB (list, bid, cpm-reco, deposit…)
│       ├── rnp/[shop]/              # table · plan · unit-econ (РНП по магазину)
│       ├── seo/ · sklejki/          # воронка · склейки по imtID
│       ├── unit/ · ctrtest/         # юнит-таблица · CTR/реклама по SKU
│       ├── planning/                # pl (план заказов, GET+POST) · skus
│       ├── sync/ · sync-log/        # оркестратор синков WB→Supabase
│       ├── supplies/ · costs/       # закупки · себестоимость
│       ├── repricer/ · signals/     # репрайсер · классификатор узких мест
│       ├── cabinets/ · users/       # мультикабинеты · сотрудники (RBAC)
│       ├── abc/ · trends/ · market/ # ABC · динамика · пульс ниши (MPSTATS)
│       ├── lab/                     # img/media/yandex-прокси (для card-editor, uniquizer)
│       └── post/ · design/          # headless: постинг соцсети · эффект карточек (без UI)
│
├── components/
│   ├── AppLayout.tsx · Sidebar.tsx · ModuleMenu.tsx · FinanceTabs.tsx
│   ├── CabinetSwitcher.tsx          # переключатель активного кабинета
│   ├── providers/FinanceProvider.tsx# глобальный стейт финансов (Context + reducer)
│   ├── calendar/ payments/ loans/ opiu/   # UI зоны Финансы
│   ├── accounts/ supplies/ sync/ agent/   # UI операций/системы
│   ├── dashboard/ModulesHome.tsx    # сетка карточек-модулей на главной
│   ├── analytics/ · ui/             # графики/таблицы · базовые элементы
│
├── lib/
│   ├── db.ts · reducer.ts · calculations.ts · constants.ts · types.ts
│   ├── supabase.ts · supabaseAdmin.ts · internalFetch.ts · format.ts · storage.ts
│   ├── auth/     # session (JWT) · roles (RBAC) · apiGuard · proxyAuth/proxySign (HMAC)
│   ├── agent/    # client (Anthropic) · gatherContext · rules (движок инсайтов)
│   ├── opiu/     # buildReport · loadMonth · metrics · weeks
│   ├── wb/       # cards · cardImage · commissions · report · cabinetTokens · localization
│   ├── ozon/     # auth · performance · analytics
│   ├── rnp/      # buildTable · buildRnp · resolveShop
│   ├── unit/ · signals/ · repricer/   # юнит · сигналы · движок репрайсера
│   ├── sync/     # cabinets · helpers (chunkedUpsert, writeSyncLog)
│   ├── mpstats/  # клиент MPSTATS · lab/ · fal/  # прокси/генерация для card-editor
│   └── google/ · yandex/ · xlsx/      # Google Drive/Sheets · Yandex Disk · Excel-экспорт
│
├── supabase/migrations/             # SQL-миграции (маркетплейс+финансы)
├── docs/                            # ONBOARDING, wb-ops-runbook, КОМАНДА-доступ и др.
├── proxy.ts                         # middleware: сессия · роль-редирект · HMAC · CRON bearer
├── AGENTS.md · CLAUDE.md · README.md
└── vercel.json · next.config.ts · tsconfig.json
```

---

## Модель данных (ключевые таблицы Supabase)

```sql
-- Финансы
accounts             (id, name, type, currency, balance)
payments             (id, name, amount, type, category, account_id, date, status, counterparty)
loans                (id, creditor, principal, rate_per_day, start_date, due_date, status)
product_costs        (article PK, brand, name, cost_rub, warehouse_expenses, entity)
opiu_warehouse_costs (entity, month, week_start PK, amount)

-- Маркетплейс (наполняются синками WB/Ozon)
wb_cabinets          (id, name, token…, cabinet-scoped мультиаккаунт)
wb_orders · wb_sales · wb_stocks
wb_funnel_daily      (nm_id, date, open_card, add_to_cart, orders, orders_sum)
wb_adverts · wb_advert_stats · wb_advert_nm_daily
ozon_ad_cache        (per-cabinet)
planning_state (year PK, data jsonb)   ctr_tests

-- RPC (агрегаты)
rnp_report · rnp_daily · rnp_daily_sku   -- ядро аналитики РНП/воронки
```

---

## Авторизация и роли (`lib/auth/roles.ts`)

| Роль | Доступ |
|------|--------|
| `director` | всё (`*`) |
| `finance` | финансы + вся аналитика МП + операции |
| `manager` | аналитика МП + себестоимость + AI-агент |

Сессия — cookie `fp_session` (httpOnly, 7 дней, JWT HS256). Гейт в `proxy.ts`: страницы без сессии → редирект `/login`; при нехватке роли → редирект на стартовую страницу роли. Все `/api/*` fail-closed: требуют сессию **или** `Bearer CRON_SECRET` (исключение — подписанные HMAC медиа-прокси `/api/lab/*-proxy`).

---

## Конвенции UI

Страница аналитики = client-компонент по образцу `/trends` и `/adverts`:
`useActiveCabinet("wb")` + `<CabinetSwitcher mp="wb" />` + `fetch("/api/...?cabinet=${cabId}")` + состояния loading/err/data. Широкие таблицы — в контейнере `overflow-x-auto` со sticky-колонкой артикула.

---

## Разработка и контрибуция

```bash
npm install && npm run dev      # http://localhost:3000 (нужен .env.local)
npx tsc --noEmit && npm run build
```

Правила команды — в **[AGENTS.md](AGENTS.md)**: ветка `feat/…`/`fix/…` → PR в `main` → AI-гейт (мелкое безопасное вливается сам, рискованное — миграции/секреты/зависимости/auth/оплата/CI/удаление — на ручное ревью владельца). Прямой push в `main` запрещён.

---

*Актуализировано после выноса контент-завода в отдельный репозиторий.*
