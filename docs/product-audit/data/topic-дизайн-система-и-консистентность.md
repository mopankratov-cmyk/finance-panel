# Аудит дизайн-системы и консистентности — finance-panel

Только чтение. Все числа получены `grep`/`wc` по `app/` и `components/` (251 файл `.tsx`, 53 274 строк) на ветке `feat/rk-dense-default`, коммит `d754487c`.

## 1. Что заявлено как дизайн-система

**`docs/MOBILE-ADAPTATION.md`** — единственный документ, описывающий систему, и только её адаптивную часть: три брейкпоинта (до 767px / 768–1023 / от 1024, `docs/MOBILE-ADAPTATION.md:16-24`), 14 готовых CSS-классов (`:82-96`), опись экранов с дефектами (`:201-414`). Цветовой палитры, шкалы отступов, шкалы шрифтов, правил компонентов там нет вообще.

**`docs/PROJECT-KNOWLEDGE.md`** — про UI только раздел 8 (`:198-204`): непрозрачный фон у `sticky`-ячеек и что `colSpan`-строка едет вместе с таблицей при горизонтальной прокрутке. Ни слова про кнопки, поля, цвета, типографику.

**`app/globals.css`** (431 строка) — реальный фундамент:
- Токены темы: `--background #f5f5f5`, `--foreground #0f172a`, `--sidebar #1a1a2e`, `--accent #7c3aed` (`:3-8`), проброшены в Tailwind через `@theme inline` как `bg-sidebar`/`bg-accent`/`bg-background`/`bg-foreground`.
- 14 утилитарных классов вне `@layer` (доступность/тач): `.scroll-x`, `.table-cards`, `.table-cards-lg`, `.tap`, `.tap-hit`, `.hover-actions`, `.chip-row`, `.break-anywhere`, `.action-bar(-fixed)`, `.has-action-bar`, `.nav-link`, `.tap-row`, `.day-cell`, `.preset-btn`.
- Никаких классов для цвета, типографики, теней, кнопок — это целиком Tailwind-утилиты по месту.

**`components/ui/` — 11 файлов, и ни одного `Button`/`Input`/`Select`/`Table`/`Badge`/`EmptyState`:**

| Файл | Роль | Есть общий примитив? |
|---|---|---|
| `Card.tsx` (40 строк) | карточка/заголовок/тело | да, но использует **`slate`**-палитру |
| `Modal.tsx` (88 строк) | модалка | да, эталонная реализация (см. §3) |
| `SlidePanel.tsx` (135 строк) | выдвижная панель | да |
| `ActionableError.tsx` (177 строк) | состояние ошибки | да, но своя **`rose`/`amber`**-палитра, отличная от Card |
| `LoadingState.tsx` (96 строк) | скелетоны/баннер загрузки | да, но своя **`gray`**-палитра (`bg-gray-100`, `border-gray-200`) |
| `Hint.tsx` (125 строк) | тултип | да |
| `Tour.tsx` (155 строк) | онбординг-подсказки | да |
| `CategoryFilter.tsx`, `DateRangePicker.tsx`, `PeriodRangePicker.tsx`, `KeepAliveTabs.tsx`, `KeyboardInset.tsx` | точечные | да |

Кнопки (750 `<button>` по всему дереву), текстовые поля (303 `<input>`), `<select>` (129 шт.) — **везде ad-hoc `className`**, единого компонента нет. Выбор периода дублирован: `PeriodRangePicker.tsx` (попап с пресетами и календарём, используется в 13 местах) и отдельно `DateRangePicker.tsx` (два `<input type="date">`, используется в `/rnp`, `/seo`) — это осознанное разделение по документу (§2), не баг, но кроме них **ещё 23 файла** держат свои `<input type="date">` вне этих двух компонентов (`components/loans/LoanForm.tsx`, `components/payments/PaymentsPage.tsx`, `components/calendar/CalendarPage.tsx` и др.) — с собственной, не всегда совпадающей версткой.

Общая таблица-примитив есть одна — `components/analytics/AnalyticsTable.tsx` (186 строк, сортировка + CSV + sticky-шапка), используется в закупках и PIM. Остальные ~40 «широких» таблиц (РНП, юнит-экономика, склад, зарплата, журнал РК) — самописные `<table>` без общего компонента, что и порождает разнобой ниже.

---

## 2. Количественный разнобой (grep по `app/` + `components/`)

### 2.1 Размер шрифта — самое большое расхождение в проекте

| Класс | Вхождений |
|---|---|
| `text-sm` | 973 |
| `text-xs` | 875 |
| **произвольные `text-[Npx]` (сумма)** | **1405**, в 132 файлах |
| `text-lg` | 58 |
| `text-xl` | 58 |
| `text-2xl` | 38 |

Разбивка произвольных значений:

```
508  text-[11px]
494  text-[10px]
210  text-[9px]
 91  text-[12px]
 39  text-[13px]
 35  text-[8px]
  9  text-[14px]
  6  text-[17px]
  5  text-[15px]
  3  text-[22px]
  2  text-[26px]
  1  text-[7px] / text-[20px] / text-[18px]
```

Т.е. **41% всех указаний размера шрифта в кодовой базе — не токен Tailwind, а произвольное пиксельное значение**, и подавляющее большинство (1248 из 1405) — это **7–11px, меньше самого мелкого стандартного `text-xs` (12px)**. Второй встроенный размерный слой шрифта в проекте не `text-xs/sm/base`, а именно эти произвольные значения — де-факто это и есть шкала, просто нигде не описанная.

Заголовок `<h1>` оформлен **шестью разными размерами** в разных экранах: `text-2xl` (18 раз), `text-lg` (12), `text-xl` (9), `text-3xl` (1), `text-[20px]` (1, `components/wb/WbModuleHeader.tsx:19`), `text-[18px]` (1).

### 2.2 Радиус скругления

```
1131  rounded-lg
 625  rounded-xl
 189  rounded          (нет суффикса)
 163  rounded-full
 157  rounded-md
  58  rounded-2xl
  13  rounded-t / rounded-r / rounded-b
   5  rounded-[9px]
   4  rounded-sm
   1  rounded-[3px] / rounded-[2px] / rounded-none
```

Пять «настоящих» уровней (`sm/md/lg/xl/2xl`) сосуществуют без правила, какой уровень для чего: карточки — то `rounded-xl` (`Card.tsx:11`), то `rounded-2xl` (`LoadingState.tsx:60`, `WbCtrDayPopup.tsx:177`); кнопки — то `rounded-lg`, то `rounded-md`, то голый `rounded`.

### 2.3 Нейтральная палитра: slate против gray

```
slate: 5242 упоминаний (bg/text/border)
gray:   415 упоминаний
zinc/neutral/stone: 0
```

`slate` — подавляющий стандарт, но `gray` не единичный сбой: он системно живёт в `components/ui/LoadingState.tsx` (весь файл — `gray-100/200`), `components/ui/DateRangePicker.tsx:15,18` (`border-gray-300`), `app/users/page.tsx`, `app/cabinets/page.tsx`, `app/losses/page.tsx`. Семь файлов смешивают `slate-*` и `gray-*` **в одном файле**: `app/losses/page.tsx`, `app/users/page.tsx`, `components/AppLayout.tsx`, `components/access/LimitsCard.tsx`, `components/dashboard/ModulesHome.tsx`, `components/pim/PimPage.tsx`, `components/ui/Tour.tsx`. Пример — `app/users/page.tsx:163-271`: рамки то `border-gray-200`, то соседние строки той же таблицы стилизованы через `slate` в других местах файла.

### 2.4 Акцентный цвет: токен объявлен, но не используется

`--accent: #7c3aed` и `--sidebar: #1a1a2e` объявлены в `app/globals.css:3-8` и проброшены в Tailwind (`bg-accent`, `bg-sidebar`). Фактическое использование этих классов по всему `app/`+`components/`: **0**. Каждое место, которому нужен тёмный сайдбар или фиолетовый акцент, пишет либо голый хекс, либо совпадающий по значению `violet-600`:

- `bg-[#1a1a2e]` — 2 раза, оба в `components/Sidebar.tsx:477,530` (плюс `ring-offset-[#1a1a2e]` там же на `:281,287`) — вместо `bg-sidebar`.
- `bg-violet-600` как основной цвет действия — **≈110 файлов**, от `components/Sidebar.tsx` до `components/warehouse/*`. Согласованно используется как «акцент WB/панели» — но нигде не как `bg-accent`, то есть токен из `globals.css` мёртв, а фактическим источником истины служит совпадение с Tailwind-палитрой.

Отдельно — **необъявленный второй фиолетовый**, используется только в РНП:
```
components/wb/RnpOperatingToolbar.tsx:220,496  → "#7567e8" как цвет по умолчанию для тегов
components/wb/WbRnpPage.tsx:1559               → bg-[#7567e8] hover:bg-[#6558d9]
components/wb/WbRnpPage.tsx:2375               → bg-[#f2f0ff] text-[#7567e8]
components/wb/WbRnpPage.tsx:2806,2817          → bg-[#7567e8] (тумблер/индикатор качества)
```
`#7567e8` визуально почти неотличим от `violet-600` (`#7c3aed`), но это **третье, ручное значение**, с ручным же затемнением под hover (`#6558d9`) вместо шага палитры Tailwind — источник тихого визуального расхождения именно в РНП.

### 2.5 «Почти белый» фон — 35 повторов одного магического числа

```
grep 'bg-\[#f6f7f9\]' → 35 вхождений в 28 файлах
```
Это фактический фон всех WB/Ozon-оболочек (`components/wb/WbShell.tsx:259`, `components/ozon/OzonShell.tsx:170`, `components/wb/WbModuleHeader.tsx:16`, и 25 других страниц), но он **не равен** объявленному `--background: #f5f5f5` (`app/globals.css:4`) и нигде не выражен переменной или классом — просто скопирован 35 раз как литерал. Рядом с ним ещё 8 близких, но не идентичных светлых оттенков-двойников: `#fafafd` (4×), `#fbfcfd` (3×), `#fafbfc` (2×), `#f7f7fa` (2×), `#f7f8fa`, `#f7f7fb`, `#F5F5F5`, `#F8FAFC` — восемь способов сказать «очень светлый нейтральный фон», ни один не выведен из токена.

Итого разных `bg/text/border/ring-[#hex]` произвольных цветов в коде — **≥30 уникальных значений** (полный список получен, топ выше), при одном объявленном `--accent` и одном `--sidebar`.

### 2.6 Два бренд-цвета маркетплейсов — консистентно, но не задокументировано

`bg-violet-600` = WB, `bg-sky-600` = Ozon — это **не хаос, а осознанное соглашение**, подтверждается прямо в коде: `app/cabinets/page.tsx:235` — `mp === "ozon" ? "bg-sky-600" : "bg-violet-600"`; `app/summary/page.tsx:104` — `<MpCard title="OZON" color="bg-sky-600" .../>`. Но нигде не оформлено как токен (`--accent-ozon` не существует), поэтому в общих для обеих площадок файлах (`components/planning/SalesPlanPage.tsx`, `components/unit/CabinetUnitSettings.tsx`, `components/calendar/OzonForecastPanel.tsx`) выбор цвета — по памяти, а не по правилу.

---

## 3. Системные несогласованности — одно понятие, разное исполнение

**Два независимых «заголовка модуля».** `components/wb/WbModuleHeader.tsx:16-23` и `components/ozon/OzonModuleHeader.tsx:29-45` решают одну задачу (иконка/eyebrow + заголовок + описание + действия), но не имеют общего предка и расходятся во всём:
- фон: `bg-[#f6f7f9]` (Wb) vs `bg-white` (Ozon);
- акцент: у Wb это `text-slate-600` на иконке, у Ozon — отдельная строка eyebrow `text-sky-600` (`OzonModuleHeader.tsx:34`), которой у Wb нет вовсе;
- заголовок: `text-[18px] sm:text-[20px]` произвольными пикселями (Wb, `:19`) vs `text-xl` токеном (Ozon, `:35`);
- кнопка обновления в Ozon-варианте (`OzonModuleHeader.tsx:56`) — своя вёрстка `h-11 ... sm:h-8`, нигде больше не переиспользуемая.

**Свои модалки в обход `Modal.tsx`/`useDialogBehavior`.** Документ прямо запрещает: «Свои оверлеи не делать — поведение придётся повторять целиком, включая то, что незаметно» (`MOBILE-ADAPTATION.md:157-158`). Фактически 16 файлов строят `fixed inset-0` вручную (`components/loans/LoansPage.tsx`, `components/payments/BankStatementModal.tsx`, `components/planning/SalesPlanAddSkuModal.tsx`, `components/wb/WbCtrDayPopup.tsx`, `components/wb/WbRkNotePopup.tsx`, `components/wb/WbRkNoteQuickPick.tsx`, `components/wb/ads/ConfirmAction.tsx` и др., исключая drawer-навигацию сайдбаров). Большинство честно подключает `useDialogBehavior` — но не все:

- **`components/wb/WbCtrDayPopup.tsx:112-121`** реализует Escape и блокировку фона **заново**, и блокировку — именно тем способом, который хук `useDialogBehavior` (`hooks/useDialogBehavior.ts:12-16`) явно называет неработающим: комментарий хука гласит «Блокировка фона сделана через `position: fixed`... а не через `overflow: hidden` на body. Причина ровно одна: в Safari на iOS `overflow: hidden` фон не держит». `WbCtrDayPopup.tsx:119` делает именно `document.body.style.overflow = "hidden"`. На iOS Safari фон под этим попапом продолжит скроллиться. Плюс — здесь нет цикла фокуса (Tab уходит за пределы диалога), у `useDialogBehavior` он есть (`hooks/useDialogBehavior.ts:59-75`).

**Пустое состояние («Нет данных») — 43 вхождения, 43 своих className**, без общего компонента (`WbEmptyState` в `components/wb/WbModuleHeader.tsx:33-38` покрывает только WB-модуль). Примеры одного и того же смысла разным оформлением:
```
app/losses/page.tsx:92                    py-16 text-center text-gray-400
components/payments/DdsOverview.tsx:128   py-8 text-center text-sm text-slate-500
components/supplies/RestrictionsPanel.tsx:65   text-xs text-slate-400
components/wb/WbRnpPage.tsx:2009          mt-2 text-sm font-semibold text-slate-700
```

**Широкие таблицы в обход `.scroll-x`.** Документ называет `.scroll-x` единственным механизмом для «таблиц сравнения» (`MOBILE-ADAPTATION.md:43-50`), с конкретной причиной — `overscroll-behavior-x: contain` не даёт жесту утянуть страницу, плюс видимый тонкий скроллбар на тач-устройствах (`app/globals.css:104-113`). Но:
```
components/wb/WbUnitPage.tsx:538-539     div.overflow-auto → table.min-w-[1560px]  (21 колонка)
components/wb/WbProductPage.tsx:226-227  div.overflow-auto → table.min-w-[1380px]  (11 колонок)
```
используют голый `overflow-auto` вместо `.scroll-x` — без containment и без тач-подсказки о том, что таблица едет вбок; на этих же экранах есть и другие таблицы, которые `.scroll-x` используют, то есть решение внутри одного экрана не единообразно.

**Фокус форм: два конкурирующих механизма примерно 50/50.**
```
focus:border-{color}-{shade}, без ring  →  159 вхождений
focus(-visible):ring-N                   →  154 вхождения
```
Кнопки почти всегда получают `focus-visible:ring-2 ring-offset-2` (заметное кольцо), а текстовые поля и `<select>` (129+303 = 432 элемента) в половине случаев вообще снимают нативный outline (`outline-none`/`focus:outline-none`, 123 вхождения без соседнего `ring`) и заменяют его только сменой цвета рамки — см. §4.

---

## 4. Доступность — объективные дефекты

### 4.1 Контраст текста (посчитан по формуле WCAG, sRGB→relative luminance)

| Класс | HEX | Контраст к белому фону | Порог WCAG AA |
|---|---|---|---|
| `text-slate-400` | `#94a3b8` | **≈2.56 : 1** | нужно 4.5:1 (обычный) / 3:1 (крупный ≥18px либо ≥14px bold) |
| `text-gray-400` | `#9ca3af` | **≈2.54 : 1** | — |
| `text-slate-300` | `#cbd5e1` | **≈1.49 : 1** | практически не читается |

Частоты применения: `text-slate-400` — 857 раз, `text-slate-300` — 123, `text-gray-400` — 84. Это не крупный декоративный текст — большинство таких классов сочетается с уже упомянутыми произвольными **мелкими** размерами:
```
grep 'text-[7-11]px] ... text-slate-400' (в обе стороны порядка классов) → 372 вхождения
```
т.е. **в 372 местах** мелкий текст (7–11px, сам по себе ниже базового `text-xs`) окрашен ещё и в цвет с контрастом ≈2.5:1 — двойное нарушение читаемости одновременно. Примеры: `components/unit/CabinetUnitSettings.tsx:127,136,151,165`, `components/Sidebar.tsx:441`, `components/payments/DdsReport.tsx:130`, `components/payments/ImportDdsModal.tsx:247,423`, `components/calendar/CalendarDayCell.tsx:89`.

### 4.2 Фокус скрыт у 123 полей ввода

```
className содержит "outline-none" (или "focus:outline-none") БЕЗ соседнего focus(-visible):ring → 123 вхождения
```
Примеры: `app/wb/team/page.tsx:224,232`, `app/cabinets/page.tsx:203,204,212,226-228,359`, `app/users/page.tsx:166,167`, `components/ui/DateRangePicker.tsx:15,18`, `components/access/LimitsCard.tsx:167`. Единственная замена нативного outline — смена цвета рамки (`focus:border-violet-500`), без изменения толщины и без тени/кольца. Для людей с нарушением цветовосприятия или низким зрением при клавиатурной навигации по 432 текстовым полям/`select` в проекте граница фокуса примерно в трети случаев неотличима от обычной серой рамки поля.

### 4.3 Статус только цветом

Большинство цветных «точек»-индикаторов в проекте продублированы текстом (хорошая практика: `components/wb/WbConnectPage.tsx:183`, `components/wb/WbHealthPage.tsx:128`, `components/wb/WbRepricerPage.tsx:212,243,251` — везде точка + подпись). Но есть исключения, где один и тот же смысл («система работает») в разных оболочках закодирован по-разному:
```
components/wb/WbShell.tsx:253     <span class="h-2 w-2 rounded-full bg-emerald-400" title="Система работает" />   — только точка + title
components/ozon/OzonShell.tsx:164 <span class="h-2 w-2 rounded-full bg-emerald-400" title="Система работает" />   — то же
components/dashboard/ModulesHome.tsx:132  точка + title + ВИДИМЫЙ текст "система работает" (скрыт на <sm)
```
В первых двух смысл сообщается только через `title` — не читается скринридером у `<span>` без роли, не доступен по фокусу и никогда не появляется на тач-устройстве (нет hover). Третий вариант ту же информацию частично показывает текстом, но тоже прячет его до `sm:` (640px) — на телефоне остаётся тот же голый цветной кружок.

### 4.4 Мелкие/скрытые цели нажатия на тач (<44×44 CSS px)

Базовый механизм (`.tap`/`.tap-hit`, `app/globals.css:117-163`) применён широко и корректно почти везде, но найдены конкретные пробелы:

- **`components/wb/WbRnpPage.tsx:3106`** — кнопка «Открыть теги и журнал» `h-6 w-6` (24×24px) в первой закреплённой ячейке РНП-матрицы (видна на любой ширине экрана, включая телефон — таблица не скрыта, а скроллится), без `.tap`/`.tap-hit`.
- **`components/wb/WbContentPage.tsx:128` и `:142`** — двойное нарушение сразу: кнопки «перенести в фотоворонку» и «удалить» размером `h-5 w-5` (20×20px), видимые **только по `group-hover:opacity-100`** (без класса `.hover-actions`, который в проекте существует именно для этого случая, `app/globals.css:171-176`) — на тач-устройстве, где `hover` не срабатывает, эти два действия физически недоступны никаким жестом. Единственное описание действия — атрибут `title` (не аудируется скринридером, не показывается тапом). Это прямое нарушение собственного правила проекта: «Вешать действие только на наведение... пальцем этого действия нет вовсе» (`MOBILE-ADAPTATION.md:195-196`).
- **`components/loans/LoansPage.tsx:620`** — кнопка закрытия карточки договора (иконка `<X>`) без `aria-label` и без `title`; для сравнения — общий `Modal.tsx:65` для той же роли ставит `aria-label="Закрыть"`. Кнопка при этом `h-11 w-11` (44×44, размер соблюдён), но у скринридера и голосового управления для неё нет доступного имени вовсе.

Итого краул axe, упомянутый в задании (~15 экранов с целями <44px), в данных совпадает: сама вёрстка `.tap`/`.tap-hit` — дисциплинированная система, но она не покрывает 100% кнопок, и именно необработанные исключения (РНП-матрица, галерея контента) — самые нагруженные экраны продукта.

### 4.5 Прочее

- `lang="ru"` на корневом layout — присутствует (`app/layout.tsx:44`), базовая доступность языка соблюдена.
- `<img>`/`alt` — 16 настоящих `<img>` в JSX, у всех есть `alt`; `next/image` в проекте не используется вовсе. Здесь дефектов не найдено (в отличие от заявленного в задании общего axe-прогона, по alt-тексту конкретно замечаний нет — не путать с общим списком продукта).
- `@media (prefers-reduced-motion: reduce)` глобально учтён (`app/globals.css:222-229`), плюс `motion-reduce:animate-none` расставлен по скелетонам (`LoadingState.tsx`) — сильная сторона.

---

## 5. Итоговая картина

Дизайн-система в проекте существует в двух не пересекающихся слоях:

1. **Слой адаптива** (`app/globals.css` + `docs/MOBILE-ADAPTATION.md`) — зрелый, с явными инвариантами, обоснованными комментариями и общим хуком `useDialogBehavior`. Нарушения единичны и находятся именно там, где кто-то вручную переизобрёл уже решённую задачу (`WbCtrDayPopup.tsx`, `WbContentPage.tsx`).
2. **Слой визуального языка** (цвет, шрифт, радиус, кнопка, поле, пустое состояние) — не описан нигде и не имеет общих компонентов вообще. Здесь и живёт вся статистика: 1405 произвольных размеров шрифта (41% от всех), 30+ произвольных hex-цветов при одном объявленном и неиспользуемом токене `--accent`, 50/50-раскол в стиле фокуса, 415 вхождений «неправильного» нейтрального (`gray` вместо `slate`).

Оба слоя пересекаются в конкретных экранах-лидерах по числу находок: РНП (`WbRnpPage.tsx`, `RnpOperatingToolbar.tsx`) и галерея контента (`WbContentPage.tsx`) — именно там нашлись самые серьёзные a11y-дефекты (нет `.tap`, hover-only без `.hover-actions`, собственный третий фиолетовый цвет).