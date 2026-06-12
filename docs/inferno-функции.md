# Инвентаризация infernoff.ru

> Снято 2026-06-12. Источник: HTML-страницы сайта (Tailwind CDN + Alpine.js, вся логика инлайн). Бэкенд приватный (`${API_BASE}/api/...`) — виден только по вызовам с фронта.

## Общая структура

Главная (`/`) — статичная сетка из 6 модулей-«агентов»:

| Модуль | URL | Статус | Реально работает? |
|--------|-----|--------|-------------------|
| **Wildberries** (агент Андер) | `/wb/` | активен | ✅ да — единственный с бэкендом |
| Финансы (Нано) | — | скоро | ❌ заглушка |
| Закупки (Саму) | — | скоро | ❌ заглушка |
| Дашборд (Гусман) | — | скоро | ❌ заглушка |
| Внешний трафик (Патрик) | `/patrick/` | MVP | ⚠️ статичный мокап, без API |
| Продукт (Мэнси) | `/product/` | активен | ⚠️ статичный мокап (хардкод фото WB), без API |

**Вывод:** вся настоящая функциональность сосредоточена в `/wb/`. `/patrick/` и `/product/` — демо-мокапы без серверной логики.

---

## Модуль `/wb/` — единая SPA с вкладками

Навигация переключает `page` (Alpine). Вкладки: **rnp, planning, unit, supplies, sklejki, seo, roadmap, design, adverts, ctrtest, tasks** + view-режимы **lab** (контент) и **funnel** (воронка).

Базовые refresh-действия (синки данных): `refreshAds`, `refreshCogs`, `refreshPrices`, `refreshStocks`, `actualizeSignals`, `runHealthcheck`.

### 1. РНП (`page==='rnp'`)
Отчёт-навигатор продаж по SKU.
- **Данные:** заказы/выкупы/остатки/оборачиваемость по магазинам. Выбор магазина (`rnp.shop`).
- **Кнопки/эндпоинты:**
  - `GET /api/rnp/{shop}/plan?month=` — план по РНП за месяц
  - `GET /api/rnp/{shop}/unit-econ` — юнит-экономика по РНП
  - сортировка таблицы (`setSort`, `toggleSortDir`)
- **Источник:** WB Statistics + план из БД.

### 2. Планирование (`page==='planning'`)
План продаж/закупок.
- `GET /api/planning/pl` и `?year=` — отчёт ОПиУ/план (P&L)
- `GET /api/planning/skus` — список SKU для плана
- `togglePlanMode` — переключение режима плана.

### 3. Юнит-экономика (`page==='unit'`)
- `openUnitCalc`, `unitToggleRow` — калькулятор юнит-экономики по строкам.
- режимы `mode==='margin'` / `mode==='price'` — расчёт «цена→маржа» и «маржа→цена».

### 4. Поставки (`page==='supplies'`)
- `refreshStocks` — обновить остатки
- `saveWbSupplyNum` — сохранить номер поставки WB
- `createWmsOrder` — создать заказ в WMS/складской системе (МойСклад?)
- `resetSupplies` — сброс
- расчёт потребности к поставке.

### 5. Склейки (`page==='sklejki'`)
- `loadSklejki` → `GET /api/sklejki` — управление «склейками» карточек WB (объединение в один товар).

### 6. SEO (`page==='seo'`)
- `GET /api/seo/skus` — список SKU
- `GET /api/seo/keywords/{...}` — ключевые слова по SKU
- `toggleSeoSku` — выбор SKU для SEO-работы.

### 7. Roadmap (`page==='roadmap'`)
- `loadRoadmap` → `GET /api/roadmap` ; `roadmapCreate` → `POST /api/roadmap/` ; `roadmapDelete` — дорожная карта задач.

### 8. Дизайн / эффекты изменений (`page==='design'`)
Отслеживание влияния изменений карточки (цена, контент) на метрики.
- `loadDesign` → `GET /api/design/effects`, `/api/design/effect/{id}`
- `GET /api/design/day-metrics`, `/api/design/day-marks` ; `toggleDayMark` → `/api/design/day-mark` — отметки на днях
- `genPriceFile` → `/api/design/price-update` — файл обновления цен
- `POST /api/content-change` — зафиксировать изменение контента
- сортировка `sortDesign` (25 кнопок-колонок).

### 9. Реклама (`page==='adverts'`) — самый насыщенный
Управление рекламными кампаниями WB.
- **Список/конфиг:** `GET /api/adverts/list`, `/api/adverts/config`, `/api/adverts/changes`
- **Кабинеты:** `advSwitchCabinet` — переключение рекламных кабинетов
- **Запуск/ставки:** `advStart` → `/api/adverts/start/{id}` ; `advToggleEnable`, `advToggleGroup`
- **Пополнение бюджета:** `advDeposit` → `/api/adverts/deposit/`, `GET /api/adverts/deposits`
- **Массовые операции:** `advBulkOpen/Apply/SelectGroup/ToggleAll/WinAdd/WinDel` → `POST /api/adverts/mass/preview` + `/api/adverts/mass/execute` (предпросмотр → применение)
- **Действия:** `advActionRun/Execute`, `advCopy`, `advWinAdd/Del`
- **Оптимизация:** `GET /api/adverts/optima-refresh-status` (фоновый статус)
- `refreshAds`.

### 10. CTR-тесты (`page==='ctrtest'`)
A/B-тесты обложек/CTR.
- `loadCtrTests` → `GET /api/ctrtest/list` ; `ctrCreate` → `POST /api/ctrtest/create` ; из URL → `/api/ctrtest/from-url`
- генерация: `ctrDoGen` → `POST /api/ctrtest/generate` ; статус → `GET /api/ctrtest/gen-status/{id}` (поллинг) ; `ctrPullGen`
- загрузка картинки `/api/ctrtest/upload`
- анализ рекламы: `GET /api/ctrtest/adv-analysis`, рекомендация CPM `/api/ctrtest/cpm-reco`
- слоты вариантов: `ctrAddSlot/ResetSlot/PickSku/NewToggle`, сортировка `ctrAdvSort`.

### 11. Задачи (`page==='tasks'`)
- список задач (вероятно из roadmap/agent_insights). `applyBulkMark`, `openBulkMark`.

### 12. Контент-лаборатория (`view==='lab'`) — фото/видео генерация
Огромный блок генерации креативов.
- **SKU/модели:** `GET /api/lab/sku-list`, `/api/lab/sku-folder/{}`, `/api/lab/model-photos/{}` ; `selectLabSku`, `selectLabModel`
- **Промпты:** `generateLabPrompt` → `/api/lab/prompt-generate` ; статус `/api/lab/prompt-status/{}` ; `regenerate` `/api/lab/prompt-regenerate/{}`
- **Фото:** `generateLabImage` → `/api/lab/image-generate` ; статус `/api/lab/image-status/{}` ; восстановление `/api/lab/recover-images/`, `/recover-latest`
- **Видео/сториборд:** `buildStoryboard` → `/api/lab/video-storyboard`, `-continue`, `-revise`, `-recover/{}` ; статус `/api/lab/video-storyboard-status/{}` ; `runSeedance` (видео-модель Seedance) → `/api/lab/video-generate`, статус `/api/lab/video-status/{}`
- **Google Drive:** `save-to-drive`, `save-frames-to-drive`, `save-video-to-drive`, `gfolder-validate` (`validateGFolder`) — сохранение в гугл-папки
- `addLabFromUrl`, `fetch-image-url`.

### 13. Воронка (`view==='funnel'`)
- `generateFunnel` → `/api/lab/funnel-start` ; статус `/api/lab/funnel-status/{}` ; недавние `/api/lab/funnel-recent` ; слайд `/api/lab/funnel-slide` ; гардероб `/api/lab/funnel-wardrobe`
- `funnelPickContent`, `funnelRefFromUrl`, `regenerateFunnelSlide`, `saveFunnelToDrive` — генерация «воронки» креативов.

---

## Фоновые процессы / автообновления

- **Поллинг асинхронных задач:** множество `setTimeout(tick, 1500–5000)` — фронт опрашивает `*-status/{id}` эндпоинты, пока генерация фото/видео/промптов/CTR/воронки не завершится.
- **Авто-refresh статусов рекламы:** `optima-refresh-status` опрашивается фоном.
- **`actualizeSignals` / `runHealthcheck`** — ручные «актуализировать сигналы» / «проверка системы».
- Явных клиентских кронов нет — расписание (синки WB) живёт на их бэкенде (недоступен).

---

## Внешние зависимости их бэкенда (по эндпоинтам)

- **WB API** — Statistics (заказы/продажи/остатки), Advert (реклама, ставки, пополнение), Analytics (воронка), Content (карточки/склейки).
- **AI-генерация:** промпты (LLM), фото (image-модель), видео (**Seedance**).
- **Google Drive** — хранение креативов.
- **WMS/склад** (`createWmsOrder`) — вероятно МойСклад.
- Своя БД (план, roadmap, ctr-тесты, design-эффекты).
