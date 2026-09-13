# Аудит: Навигация, ИА, дубли экранов

Репозиторий: `finance-panel` (worktree `awesome-curran-0a7729`), ветка `feat/rk-dense-default`. Только чтение, изменений не вносил. Все ссылки — `путь/к/файлу:строка`.

Существует более ранний срез этого же аудита в `docs/product-audit/data/` (crawl, `map-issues.json`, `verified-findings.json`, `summary.json`). Ниже я перепроверил заявленное по коду самостоятельно, а не переписал файлы; там, где беру факт оттуда, это отмечено явно.

---

## 1. Общая архитектура навигации

В приложении не одна навигация, а **три независимых оболочки**, переключаемые по префиксу пути в `components/AppLayout.tsx:19-119`:

| Условие (`AppShell`, `components/AppLayout.tsx`) | Что рендерится |
|---|---|
| `pathname === "/login" \| "/privacy"` (:23) | без сайдбара вообще |
| `pathname.startsWith("/wb"\|"/ozon"\|"/warehouse")` (:27-29) | без общего `Sidebar` — у каждого модуля своя оболочка |
| `pathname === "/"` (:31-32, 91-93) | полноэкранный лаунчер, без сайдбара |
| всё остальное | общий `components/Sidebar.tsx` |

То есть глобальный `Sidebar.tsx` в реальности обслуживает не «всю панель», а только оставшиеся вне WB/Ozon/Warehouse маршруты (финансы, кабинеты/сотрудники, agent, и — как выяснилось — старые дубли-сироты, см. §4).

### 1.1. Модульные оболочки

- **WB**: `app/wb/layout.tsx` → `WbCabinetProvider` + `components/wb/WbShell.tsx` (355 строк, свой рельс-сайдбар, свой мобильный низ).
- **Ozon**: `app/ozon/layout.tsx` → `OzonCabinetProvider` + `components/ozon/OzonShell.tsx`.
- **Warehouse**: `layout.tsx` у `app/warehouse` **нет** — навигация вшита прямо в `components/warehouse/WarehouseShell.tsx`, монтируется из самой страницы.
- **Финансовый контур**: общий `components/Sidebar.tsx`, но он не один список, а 4 варианта, переключаемые по `lib/navigation/sidebar.ts:1-31` (`isFinanceSidebarPath` / `isSystemSidebarPath` / `isAgentSidebarPath`): `FINANCE_NAV_GROUPS`, `SYSTEM_NAV_GROUPS`, `AGENT_NAV_GROUPS` и «полный» `NAV_GROUPS` как fallback (`components/Sidebar.tsx:256-263`).

Важное наблюдение про этот fallback — см. §4.3, оно системное, а не косметика.

### 1.2. Лаунчер на «/»

`app/page.tsx` → `components/dashboard/ModulesHome.tsx`. Плиток всего 5, жёстко зашиты в `PRIMARY_MODULES` (`components/dashboard/ModulesHome.tsx:31-37`):

```31:37:components/dashboard/ModulesHome.tsx
const PRIMARY_MODULES: ModuleCard[] = [
  { title: "РНП WB", ... href: "/wb/rnp", ... },
  { title: "Ozon Cockpit", ... href: "/ozon", ... },
  { title: "Финансы", ... href: "/calendar", ... },
  { title: "Склад", ... href: "/warehouse", ... },
  { title: "Кабинеты", ... href: "/cabinets", ... },
];
```

Отфильтровано по `canAccess` (:110). Ни один из «старых» дублей (`/rnp`, `/seo`, `/product`, …), ни `/pnl`, `/opiu`, `/losses`, `/price-solver`, `/uniquizer` на лаунчере не видны в принципе — попасть на них с главной страницы нельзя ни при какой роли.

### 1.3. Хлебные крошки

**Не реализованы нигде.** Поиск `breadcrumb|хлебн` по `app/ lib/ components/ docs/` даёт единственное совпадение — упоминание в спеке `docs/tz/sales-plan-per-cabinet-design.md:114` («хлебные крошки «Операции / План продаж»»), которое **не реализовано** в самом экране (`components/wb/WbSalesPlanPage.tsx` — по этой строке ни одного вхождения). Ни `WbShell`, ни `OzonShell`, ни общий `Sidebar` крошек не рисуют — ориентация только через подсвеченный пункт меню + заголовок `<h1>` внутри страницы.

---

## 2. Переключатель кабинетов: где хранится и переносится ли между экранами

Тут в панели три разных по зрелости механизма — это важно для ответа «что теряется при обновлении/Назад».

### 2.1. WB/Ozon-модуль (актуальная реализация)

`components/wb/WbCabinetContext.tsx`:
- ключ `localStorage`: `"fp_cab_wb"` (:57);
- на каждый выбор кабинета одновременно (а) пишет в `localStorage` (`remember`, :134-140) и (б) переписывает URL через `router.replace(pathname?cabinet=…)` (`replaceCabinetInUrl`, :125-132);
- при заходе на страницу приоритет: `?cabinet=` из URL → текущее состояние → `localStorage` → первый доступный (:142-189).

Значит внутри `/wb/*` кабинет **переживает** и обновление страницы (F5), и «Назад» — он в URL. Ozon устроен идентично, ключ `"fp_cab_ozon"` (`components/ozon/OzonCabinetContext.tsx:51`).

Каждая внутренняя ссылка `WbShell` тоже принудительно дописывает `?cabinet=` (`components/wb/WbShell.tsx:93`: `${item.href}?cabinet=${encodeURIComponent(cabinetId)}`) — поэтому кабинет не теряется и при переходах между разделами модуля.

### 2.2. Старые «финансовые» страницы (в т.ч. дубли из §4)

`lib/useActiveCabinet.ts` — используется в `/rnp`, `/seo`, `/sklejki`, `/unit` (через `UnitMarginPage`), `/reviews`, `/supplies` (через `CabinetSwitcher` из `components/CabinetSwitcher.tsx:13`):

```5:22:lib/useActiveCabinet.ts
// Активный кабинет по маркетплейсу, сохраняется в localStorage.
export function useActiveCabinet(mp: "ozon" | "wb"): [string, (v: string) => void, boolean] {
  const key = `fp_cab_${mp}`;
  ...
```

Тот же ключ `fp_cab_wb`/`fp_cab_ozon`, что и у нового модуля — **поэтому кабинет реально переносится между старым `/rnp` и новым `/wb/rnp`**, если открывать их вручную одно за другим. Но здесь **нет синхронизации с URL**: адресная строка кабинет не показывает, поделиться ссылкой на конкретный кабинет с этой старой страницы нельзя, и «Назад» браузера её не восстановит по URL (только по localStorage, который «Назад» не трогает — так что по факту тоже не теряется, просто по другой причине).

Отдельная деталь: `CabinetSwitcher.tsx` (старые страницы) умеет группы кабинетов (`group:<id>`, :46,50,76-82), а `WbCabinetContext.isAllowed` (:116-123) проверяет только точные id или `"all"` — группы там не разбираются. Это ещё один функциональный разрыв между старой и новой версией переключателя, независимо от экрана.

### 2.3. Модуль «Склад» (самая зрелая реализация)

`components/warehouse/WarehousePage.tsx:186-189` пишет `tab` и `entity` прямо в URL через `window.history.replaceState`, плюс `localStorage`-фолбэк (:168-176, :196-199), с приоритетом: адрес из URL → localStorage → первое юрлицо с кабинетами. Это подтверждается и крауловым логом: `/warehouse` открывается как `/warehouse?tab=balances&entity=…` (`docs/product-audit/data/crawl-desktop.json`). Это единственное место в панели, где **и вкладка, и кабинет/юрлицо** переживают обновление страницы.

**Вывод по §2**: в панели три архитектуры персистентности одновременно — (1) Склад: URL для всего; (2) WB/Ozon-модуль: URL только для кабинета; (3) старые страницы: localStorage только для кабинета, без URL. Это не баг сам по себе, но объясняет разное поведение «Назад»/обновления на разных экранах, включая пункт §5.

---

## 3. Фильтры / период / вкладки: что теряется при обновлении и «Назад»

Проверил построчно набор `useState` в компонентах и наличие `useSearchParams`/`localStorage`:

```bash
grep -n "useSearchParams\|searchParams.get" components/wb/WbRnpPage.tsx components/wb/WbSeoPage.tsx \
  components/wb/WbSklejkiPage.tsx components/wb/WbUnitPage.tsx components/wb/WbProductPage.tsx \
  components/wb/WbSuppliesPage.tsx components/wb/WbReviewsPage.tsx
# → пусто во всех семи файлах
```

Ни один из «новых» WB-экранов **не читает параметры из URL** для чего-либо, кроме кабинета (кабинет приходит через `useWbCabinet()`, см. §2.1). Всё остальное — период/диапазон дат, гранулярность, активная вкладка, сортировка, фильтры, режим карточки/таблицы — обычный `useState` без синхронизации:

- `components/wb/WbRnpPage.tsx:657` `range` (период), `:659` `granularity`, `:668-669` `burnedOnly/lossOnly`, `:692` `mobileView`, `:703-704` `metricViewId/metricFields` — **все теряются при F5 и при «Назад»**. Исключение — два конкретных localStorage-ключа: пресеты фильтров `RNP_FILTER_PRESETS_STORAGE_KEY` (:462,474) и раскладка колонок `RNP_MATRIX_STORAGE_KEY` (:493,516) — они переживают обновление, но это не текущий выбор, а сохранённые именованные наборы.
- `components/wb/WbSeoPage.tsx`, `WbSklejkiPage.tsx`, `WbUnitPage.tsx`, `WbSuppliesPage.tsx` — период/вкладка/режим тоже чистый `useState`, ничего не пишут ни в URL, ни в localStorage.
- Табы в `components/wb/WbSuppliesPage.tsx:57` (`tab`), `components/supplies/SuppliesPage.tsx:30`, `components/opiu/OpiuPage.tsx:191` (`OpiuTab`), `components/ozon/OzonSalesPage.tsx:49` — везде тот же паттерн, без `router.replace`/`useSearchParams` (проверено `grep -ln "useSearchParams\|router.replace\|router.push"` — по всем нулевой результат).

Старые страницы (`/rnp`, `/seo`, `/sklejki`) ведут себя так же: `app/rnp/page.tsx:145-147` (`win`, `customFrom`, `customTo`) и `app/seo/page.tsx:324-326` — тоже голый `useState`, тоже сбрасывается на дефолт при обновлении.

**Итог**: единственное, что гарантированно переживает и обновление страницы, и «Назад» в WB/Ozon-модуле — это выбранный **кабинет** (URL + localStorage). Период, вкладка, сортировка, фильтры, режим отображения — везде, где я проверял (кроме модуля «Склад», §2.3), сбрасываются к дефолту при перезагрузке и не восстанавливаются кнопкой «Назад», потому что состояние не в URL и не в истории — компонент просто монтируется заново со стартовыми значениями.

---

## 4. Дубли и параллельные версии

### 4.1. 13 редиректов — подтверждено кодом и логом краула

Список из задания подтверждён 1:1 логом `docs/product-audit/data/crawl-desktop.json` (все 13 отдают `200` и меняют путь, а не только добавляют `?cabinet=`, как остальные `/wb/*`/`/ozon/*`):

| Старый путь | Реализация | Куда ведёт | Что теряется в query |
|---|---|---|---|
| `/abc` | `app/abc/page.tsx:5` → `lib/wb/retiredRoutes.ts:3` | `/wb/rnp` | всё (searchParams не читается) |
| `/wb/abc` | `app/wb/abc/page.tsx:5` → `retiredRoutes.ts:2` | `/wb/rnp` | всё |
| `/planning` | `app/planning/page.tsx:5` → `retiredRoutes.ts:7` | `/wb/rnp` | всё |
| `/wb/health` | `app/wb/health/page.tsx:5` → `retiredRoutes.ts:8` | `/wb/rnp` | всё |
| `/wb/tasks` | `app/wb/tasks/page.tsx:5` → `retiredRoutes.ts:9` | `/wb/rnp` | всё |
| `/trends` | `app/trends/page.tsx:5` → `retiredRoutes.ts:5` | `/wb/market` | всё |
| `/wb/trends` | `app/wb/trends/page.tsx:5` → `retiredRoutes.ts:4` | `/wb/market` | всё |
| `/market` | `app/market/page.tsx:3-5` (жёсткая строка) | `/wb/market` | всё |
| `/ctrtest` | `app/ctrtest/page.tsx:3-5` | `/wb/ctr` | всё |
| `/wb` | `app/wb/page.tsx:3-5` | `/wb/rnp` | всё |
| `/adverts` | `app/adverts/page.tsx:11-13` | `/wb/adverts` | сохраняет только `cabinet` |
| `/wb/ads` | `app/wb/ads/page.tsx:12-14` | `/wb/adverts` | сохраняет только `cabinet` |
| `/repricer` | `app/repricer/page.tsx:72-83` | `/wb/funnel?view=repricer` | сохраняет только `cabinet`, добавляет `view` |

9 из 13 редиректов не читают `searchParams` вообще — теряют **любой** параметр, включая кабинет (по факту это чаще не критично, т.к. на новой странице кабинет подхватится из `localStorage`, см. §2.2 — но если человек шарит ссылку с конкретным кабинетом на один из этих 9 путей, получатель попадёт «в свой последний кабинет», а не в тот, что был в ссылке).

Найден и мёртвый/вводящий в заблуждение элемент в самой таблице редиректов:

```1:9:lib/wb/retiredRoutes.ts
const RETIRED_WB_ROUTES = {
  "/wb/abc": "/wb/rnp",
  "/abc": "/wb/rnp",
  "/wb/trends": "/wb/market",
  "/trends": "/wb/market",
  "/wb/planning": "/wb/rnp",
  "/planning": "/wb/rnp",
  "/wb/health": "/wb/rnp",
  "/wb/tasks": "/wb/rnp",
} as const;
```

Ключ `"/wb/planning"` (строка 6) нигде не используется — `grep -rn "wbRetiredRouteDestination"` не находит ни одного файла, который вызывал бы его с этим аргументом. Живой `app/wb/planning/page.tsx:1-5` рендерит `WbSalesPlanPage` (реальная фича «План продаж», отдельно объявленная в `lib/wb/navigation.ts:9` и включённая в меню WB-модуля). То есть путь `/wb/planning` уже переиспользован под другую, не связанную с «retired», функциональность, а строка в таблице «сирота» и рискует ввести в заблуждение при будущей правке (например, кто-то добавит `app/wb/planning/page.tsx` с редиректом по этому ключу и снесёт живой экран).

### 4.2. Запрошенные пары `/x` vs `/wb/x`

Все восемь пар проверил по реальному коду компонентов и вызовам API — не по названию файла.

| Пара | Старый (строк) | Новый (строк) | Общий backend | Вердикт |
|---|---|---|---|---|
| `/rnp` vs `/wb/rnp` | `app/rnp/page.tsx` (184) | `components/wb/WbRnpPage.tsx` (3404) | `/api/rnp/{cab}/table` (`app/rnp/page.tsx:160` vs `WbRnpPage.tsx:896`) | **Не редирект — два независимых фронта на одном API.** Новый добавляет план (`/api/rnp/{cab}/plan`, :961,1446), операции (`/api/rnp/{cab}/operations`, :986,1356), сохранённые пресеты и матрицу метрик (localStorage), сравнение SKU, мобильный режим. Старый — просто таблица с окном 7/14/30д. |
| `/seo` vs `/wb/seo` | `app/seo/page.tsx` (152) | `components/wb/WbSeoPage.tsx` (311) | `/api/seo/skus` (`app/seo/page.tsx:337` vs `WbSeoPage.tsx:106`) | Дубль. Новый добавляет drill-down по ключевым словам `/api/seo/keywords/{nm}` (`WbSeoPage.tsx:136`), старый его не имеет. |
| `/sklejki` vs `/wb/sklejki` | `app/sklejki/page.tsx` (168) | `components/wb/WbSklejkiPage.tsx` (309) | `/api/sklejki` (`app/sklejki/page.tsx:521` vs `WbSklejkiPage.tsx:210`) | Дубль. Старый — фиксированное окно 7 дней; новый параметризует `mode` и период. |
| `/product` vs `/wb/product` | `app/product/page.tsx`→`components/pim/PimPage.tsx` (213) | `components/wb/WbProductPage.tsx` (276) | `/api/pim` (`PimPage.tsx:35` vs `WbProductPage.tsx:86`) | **Не чистый «старый уступает новому»**: новый добавляет историю цены `/api/pim/{nmId}/history` (`WbProductPage.tsx:114`), но старый уникально умеет «тест обложек» `/api/cover-test` (`PimPage.tsx:15,54`), которого в новом **нет**. Функциональность разъехалась в обе стороны. |
| `/supplies` vs `/wb/supplies` | `app/supplies/page.tsx`→`SuppliesPage.tsx` (246) | `WbSuppliesPage.tsx` (261) | `/api/supplies` (`SuppliesPage.tsx:47` vs `WbSuppliesPage.tsx:112`) | Дубль, новый добавляет доп. вкладки с собственными источниками (см. коммент `WbSuppliesPage.tsx:93,165`). **Важно**: роль `buyer` физически не может попасть на `/wb/supplies` — см. §4.4. |
| `/unit` vs `/wb/unit` | `app/unit/page.tsx`→`UnitMarginPage.tsx` (160) | `WbUnitPage.tsx` (671) | `/api/unit/table` (`UnitMarginPage.tsx:44` vs `WbUnitPage.tsx:173`) | Дубль, новый на порядок больше: решатель цены `/api/unit/price-solver` (:325), ручные пересчёты `/api/unit/refresh-*` (:355). Есть ещё и **третий** родственный экран, см. ниже. |
| `/reviews` vs `/wb/reviews` | `app/reviews/page.tsx`→`ReviewsPage.tsx` (190) | `WbReviewsPage.tsx` (167) | `/api/reviews`, общий тип `ReviewRow` из `app/api/reviews/route` импортирован в обоих (`ReviewsPage.tsx:11`, `WbReviewsPage.tsx:11`) | Самый «чистый» дубль пары — заметной разницы в возможностях не нашёл, оба почти одинакового размера и бьют в тот же тип/эндпоинт. |
| `/pnl` vs `/opiu` | `app/pnl/page.tsx`→`MonthlyOpiuPage.tsx` (230) | `app/opiu/page.tsx`→`OpiuPage.tsx` (832) | Разные: `/pnl` — месячный ОПиУ по WB **и** Ozon вместе (`MonthlyOpiuPage.tsx: wb/ozon`, `currentMonthParam`); `/opiu` — понедельный, только WB, по брендам, с двумя вкладками sale_date/report_date (`OpiuPage.tsx:12,191`, `OPIU_BRANDS`) | **Не дубль.** Разная гранулярность и разный контур (моно-WB vs WB+Ozon). Оба реально в меню: `Sidebar.tsx:89,91` и `:136,138`. Риск — не в коде, а в ИА: названия «ОПиУ» и «опиу» (транслитерация той же аббревиатуры) на соседних пунктах меню читаются как один и тот же отчёт. |

### 4.3. Скрытая находка: третий экран маржи + сломанный тест

У «юнит-экономики» на самом деле **три** параллельных реализации, и это подтверждено намеренно в коде:

```5:12:tests/unit-group-ui.test.mts
// Маржу по артикулам показывают ДВА разных экрана, и это намеренно:
// `/unit` — рабочий экран менеджера, живёт без финансовых вкладок и получает
// кабинет параметром; `/opiu/margin` — тот же смысл внутри финансового
// контура, со вкладками и кабинетом из сессии. ...
```

`/opiu/margin` (`app/opiu/margin/page.tsx` → `components/opiu/MarginByArticlePage.tsx`) бьёт в отдельный `/api/opiu/margin` (`MarginByArticlePage.tsx:75`) — то есть это не дубль `/unit`/`/wb/unit`, а третий, финансово-контурный отчёт, что подтверждено комментарием разработчика в тесте. Это нормально.

Но сам этот регресс-тест сейчас **падает** (см. `docs/product-audit/data/summary.json:10`: *«tests/unit-group-ui.test.mts — ищет пункт меню { href: "/opiu/margin", label: "Маржа по артикулам" }»*), потому что он проверяет наличие строки в файле, который больше не хранит меню:

```22:tests/unit-group-ui.test.mts
  assert.match(tabs, /\{ href: "\/opiu\/margin", label: "Маржа по артикулам" \}/);
```

— тест читает `components/FinanceTabs.tsx`, но этот компонент давно превращён в компатибилити-заглушку без списка ссылок (`components/FinanceTabs.tsx:1-31`, весь список отрисовки — `null`/side-effect для скрытия групп меню). Реальный пункт меню переехал в `components/Sidebar.tsx:139` (`{ href: "/opiu/margin", label: "Маржа по артикулам" }`, группа `FINANCE_NAV_GROUPS`). Это прямое, легко проверяемое свидетельство того, что рефакторинг навигации (вынос ссылок в `Sidebar.tsx`) прошёл, а тест на структуру навигации — нет. Именно та категория дефектов, которую просили найти в этом аудите.

### 4.4. Экраны без входа из меню

Проверил все статические массивы ссылок: `components/Sidebar.tsx` (`NAV_GROUPS`, `FINANCE_NAV_GROUPS`, `SYSTEM_NAV_GROUPS`, `AGENT_NAV_GROUPS`, `quickNav`), `components/wb/WbShell.tsx`/`lib/wb/navigation.ts`, `components/dashboard/ModulesHome.tsx`, `components/ModuleMenu.tsx`. Ни в одном из них нет ссылок на `/rnp`, `/seo`, `/sklejki`, `/product`, `/reviews`, `/supplies`, `/unit` — то есть все семь «старых» дублей из §4.2 живы исключительно потому, что их путь всё ещё разрешён в `lib/auth/roles.ts:48,52` (`FINANCE_PATHS`/`MERCH_PATHS`), а не потому, что до них можно дойти кликом.

Кроме них, без единой ссылки в интерфейсе:

- **`/price-solver`** (`app/price-solver/page.tsx`, «Решатель цены») — не встречается ни в одном `href`/`Link` во всём `app/`+`components/`+`lib/`, только в списке прав (`lib/auth/roles.ts:48`). Функционал (расчёт цены под целевую маржу) частично дублирован внутри `/wb/unit` через тот же `/api/unit/price-solver` (`WbUnitPage.tsx:325`), но сама отдельная страница — тупик.
- **`/uniquizer`** (`app/uniquizer/page.tsx`, видео-«уникализатор») — читает исходник через `?src=` (`app/uniquizer/page.tsx:23`, `sp.get("src")`), то есть спроектирована как приёмник ссылки из внешнего источника. По `AGENTS.md` (корень репо, раздел «Контент-завод переехал»), контент-завод (`app/inferno`, `app/carousel`, `app/video-overlay`, `app/api/factory`) выделен в отдельный репозиторий 2026-07-06 — вероятный поставщик `?src=` для уникализатора. Сейчас в этом репо нет ни одного места, что формирует такую ссылку (проверено тем же grep) — страница осталась без входа дважды: нет пункта меню и, вероятно, нет действующего источника данных.
- **`/losses`** («Где теряем») формально **есть** в `NAV_GROUPS.finres` (`Sidebar.tsx:92`), но этот массив — тот самый «полный» fallback, который показывается только когда путь не финансовый/не системный/не агентский (`Sidebar.tsx:202-204,257-263`). А `/losses` сам входит в `FINANCE_SIDEBAR_PATHS` (`lib/navigation/sidebar.ts:4`) — значит, находясь на `/losses`, пользователь видит `FINANCE_NAV_GROUPS` (`Sidebar.tsx:131-161`), где пункта `/losses` **нет**. Полный `NAV_GROUPS` с этим пунктом реально показывается только на страницах вроде `/rnp`, `/product`, `/price-solver` — которые сами уже сироты (см. выше). Итог: `/losses` объявлен в коде меню, но не имеет ни одного практически достижимого клика ни с лаунчера, ни из финансового контура, ни из WB/Ozon.
- **`/card-editor`** — не в постоянном меню, но не полностью сирота: единственная ссылка на него — контекстная, из результата генерации в UGC-мастере (`components/wb/WbUgcPage.tsx:221`, `` `/card-editor?img=${encodeURIComponent(selectedJob.resultUrl)}` `` после «Проверьте и опубликуйте»). Найти экран напрямую (без прохождения UGC-сценария) нельзя.
- **`components/ModuleMenu.tsx`** — отдельная, полностью готовая компонента «сквозного меню модулей», её собственный комментарий говорит прямо: «убирает тупики на полноэкранных страницах (Ozon и др.)» (`ModuleMenu.tsx:8`). `grep -rln "ModuleMenu"` находит только сам файл — компонент **нигде не подключён**. То есть решение проблемы тупиков на полноэкранных модулях (для которой он и был написан) существует в коде, но не смонтировано ни в `OzonShell.tsx`, ни в `WbShell.tsx`, ни где-либо ещё.

### 4.5. `/pnl/balance` — живой пункт меню, ведущий на заглушку

`Sidebar.tsx:90,137` линкует «Баланс» на `/pnl/balance`, а сама страница — это каркас:

```10:18:app/pnl/balance/page.tsx
      <h1 className="text-2xl font-bold text-slate-900">Баланс</h1>
      <p className="mt-1 text-sm text-slate-500">
        Каркас раздела создан. Состав активов, обязательств и капитала будет разработан отдельным этапом.
      </p>
```

Не мёртвая ссылка (страница существует, 200), но по факту — «дверь в никуда» с точки зрения содержания, доступная из главного меню наравне с рабочими разделами.

---

## 5. Мёртвые ссылки на несуществующие маршруты

Собрал **все** `href` из статических массивов навигации (`Sidebar.tsx` — все 4 варианта + `quickNav`, `WbShell.tsx`/`lib/wb/navigation.ts`, `ModulesHome.tsx`, `ModuleMenu.tsx`) и сверил с деревом `app/`. Результат: **404 не нашёл** — каждый прописанный `href` соответствует реальной директории с `page.tsx` (включая менее очевидные `/wb/content`, `/wb/connect`, `/wb/team`, `/opiu/margin`, `/pnl/balance`).

Единственная выявленная нестыковка структурного, а не «битой ссылки», характера — уже описанный мёртвый ключ `"/wb/planning"` в `lib/wb/retiredRoutes.ts:6` (§4.1): он не битый (никто по нему не редиректит), но рассинхронизирован с реальностью и может стать источником регресса при следующей правке.

Отдельно проверил доступность через роли (это не «битая ссылка», а «ссылка ведёт мимо, потому что роли не совпадают» — тоже форма дохлого перехода):

**Двойной отскок для `buyer` по любому «retired»-адресу `/wb/*`.** `proxy.ts:290-293`:

```290:293:proxy.ts
  if (!allowsModulePath(session, pathname) || !canAccess(sessionRoles(session), pathname)) {
    ...
    url.pathname = roleHome(session);
    return NextResponse.redirect(url);
```

У `buyer` разрешены только `["/", "/supplies", "/warehouse", "/costs", "/planning", "/unit", "/abc"]` (`lib/auth/roles.ts:70`) — префикса `/wb` там нет. Цепочка для закупщика, открывшего старую закладку `/abc`:
1. `canAccess(buyer, "/abc")` = true (буквально в списке) → проходит через `proxy.ts`;
2. `app/abc/page.tsx:5` редиректит на `/wb/rnp` (`retiredRoutes.ts:3`);
3. `proxy.ts` перепроверяет уже `/wb/rnp` — `canAccess(buyer, "/wb/rnp")` = false (нет `/wb` в списке);
4. `roleHome(buyer)` = `/supplies` (`roles.ts:13`) → второй редирект.

Итог: закупщик по старой закладке `/abc` молча оказывается на `/supplies` — без единого сообщения о причине. Ровно то же самое произойдёт с `/planning` и `/wb/health`/`/wb/tasks` (все ведут в `/wb/rnp`, которого у buyer нет).

**Роль `buyer` физически заперта на старом дубле `/supplies`.** Её домашний экран — `/supplies` (`roles.ts:13`), а `/wb/supplies` ей не разрешён (нет `/wb` в списке доступа, `roles.ts:70`) — то есть buyer не может дойти до нового, более функционального экрана закупок даже вручную набрав адрес; он получит тот же двойной отскок обратно на `/supplies`.

**Роль `hr` — тупик на лаунчере.** `ROLE_HOME.hr = "/payroll"` (`roles.ts:10`), `ACCESS.hr = ["/", "/payroll"]` (`roles.ts:61`). `/payroll` входит в `FINANCE_SIDEBAR_PATHS` (`lib/navigation/sidebar.ts:7`), поэтому на `/payroll` сайдбар — финансовый, а единственная ссылка «На главную» там ведёт на `/` (`Sidebar.tsx:335-345`, `financeHomeLinkClass`). На `/` фильтр `PRIMARY_MODULES.filter(m => canAccess(me.role, m.href))` (`ModulesHome.tsx:110`) для hr отсекает все 5 плиток (ни `/wb/rnp`, ни `/ozon`, ни `/calendar`, ни `/warehouse`, ни `/cabinets` ему не открыты) — экран показывает «0 модулей» без единой рабочей ссылки назад. Единственный выход — кнопка выхода в шапке или прямой набор `/payroll` в адресной строке.

---

## 6. Сводка по темам аудита

- **Меню/сайдбары**: не одно дерево, а 3 независимые оболочки (WB, Ozon, «остальное» через `Sidebar.tsx`) + 4 варианта самого `Sidebar.tsx` по типу страницы.
- **Лаунчер**: 5 жёстко заданных плиток, отфильтрованных по роли; часть ролей (`hr`) видит пустой экран без выхода.
- **Переключатель кабинетов**: 3 разных механизма зрелости — Склад (URL+LS для вкладки и юрлица) > WB/Ozon-модуль (URL+LS для кабинета) > старые страницы (только LS, без URL). Ключ `localStorage` общий (`fp_cab_wb`/`fp_cab_ozon`), поэтому кабинет реально переносится между старой и новой версией экрана.
- **Крошки**: отсутствуют полностью, упомянуты только в спеке.
- **13 редиректов**: подтверждены построчно, 9 из 13 теряют все query-параметры.
- **8 запрошенных пар**: 6 — реальные, независимо поддерживаемые дубли на общем backend (`/rnp`, `/seo`, `/sklejki`, `/product`, `/supplies`, `/unit`, `/reviews` — по факту 7, не 6), у пяти из них новая версия строго богаче старой, у `/product` функциональность разошлась в обе стороны (старый умеет то, чего нет в новом). `/pnl` vs `/opiu` — не дубль, разные отчёты, оба в меню. Плюс найден третий, намеренно отдельный вариант «маржи» — `/opiu/margin` — и сломанный регресс-тест на его пункт меню.
- **Экраны без входа из меню**: 7 старых дублей + `/price-solver`, `/uniquizer`, `/losses` (формально в коде, практически недостижим), `/pnl/balance` (в меню, но заглушка), `/card-editor` (только контекстный вход из UGC), плюс мёртвый, ни разу не смонтированный компонент `ModuleMenu.tsx`, написанный именно для решения этой проблемы.
- **Фильтры/период/вкладки**: везде, кроме модуля «Склад», это чистый `useState` — не переживают ни F5, ни «Назад». Персистентен только кабинет (и, в РНП, — сохранённые пресеты/раскладка колонок).
- **Мёртвые ссылки**: в статических меню не нашёл ни одной битой (все `href` существуют как маршруты); зато нашёл структурно мёртвый ключ в `retiredRoutes.ts` и два конкретных, воспроизводимых случая, когда роль (`buyer`, `hr`) технически «долетает» до существующего маршрута, но там для неё дальше некуда идти.