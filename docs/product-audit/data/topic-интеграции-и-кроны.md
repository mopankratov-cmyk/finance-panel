# Аудит: интеграции и кроны — finance-panel

## 1. `vercel.json` — полный реестр кронов

Регион выполнения: `fra1` (`vercel.json:2-4`). Все 31 задание идут HTTP GET-запросом от Vercel Cron с автоматическим заголовком `Authorization: Bearer $CRON_SECRET`; авторизацию на стороне приложения проверяет `checkCronAuth()` (`lib/sync/helpers.ts:8-19`) — **если `CRON_SECRET` не задан в окружении, проверка полностью пропускается** (комментарий в коде: `// dev: skip check`, `lib/sync/helpers.ts:10`). Это осознанный dev-фолбэк, но при случайном отсутствии секрета в проде все `/api/sync/*` и рядовые машинные роуты стали бы открытыми без аутентификации.

| Путь | Расписание | Что делает | Пишет в БД | Внешние API |
|---|---|---|---|---|
| `/api/sync/all?hourly=1` | `0 * * * *` | Оркестратор: параллельно гоняет `orders, sales(выкл в hourly-режиме), stocks(выкл), adverts→advert-stats, fbs-orders` через внутренний fetch + восстановление глубокой истории (`runWbHistoryRecovery`) (`app/api/sync/all/route.ts:1-40`, `lib/sync/orchestrator.ts:1-139`) | все таблицы дочерних джоб | WB (через дочерние роуты) |
| `/api/sync/sales` | `2 * * * *` | Продажи WB (`statistics-api.wildberries.ru/api/v1/supplier/sales`), с курсором и перехлёстом окна | `wb_sales`, `wb_sync_state` | WB Statistics API |
| `/api/sync/stocks` | `4 * * * *` | Остатки FBO (`warehouse_remains`, задачный отчёт) | `wb_stocks` | WB Seller-Analytics API |
| `/api/sync/fbs-stocks` | `40 * * * *` | Остатки FBS по одному кабинету за проход (ротация по часовым слотам) | `wb_fbs_stocks` | WB Marketplace API |
| `/api/sync/stocks-history` | `0 */4 * * *` | Снимок `wb_stocks` (только ненулевые строки) в историю | `wb_stocks_history` | — (внутр. чтение БД) |
| `/api/sync/stocks-history-cleanup` | `0 3 * * *` | Чистка снимков старше 90 дней, батчами по 1000 | `wb_stocks_history` (delete) | — |
| `/api/sync/dashboard-cache?marketplace=wb` | `45 * * * *` | Прогрев кэша РНП + вторичных дашбордов WB | кэш-таблицы РНП | WB (косвенно, через прогреваемые эндпоинты) |
| `/api/sync/feedbacks` | `10 * * * *` | Отзывы/вопросы WB (неотвеченные + 35 дней отвеченных) | `wb_feedbacks`, `wb_sync_state` | WB Feedbacks API |
| `/api/sync/funnel` | `20 * * * *` | Воронка по SKU (открытия/корзины/заказы), батчами по 20 nm с паузой 21с | `wb_funnel_daily` | WB Seller-Analytics API |
| `/api/sync/paid-storage` | `30 * * * *` | «Платное хранение», только 3 кабинета из `OPIU_CABINET_IDS` (для ОПиУ) | `wb_paid_storage_rows` | WB Seller-Analytics API (задачный отчёт) |
| `/api/sync/advert-spend-history` | `35 * * * *` | История списаний по рекламе, только OPIU-кабинеты | `wb_advert_spend_history` | WB Advert API |
| `/api/sync/ozon-adverts` | `25 * * * *` | Суточные итоги + разнесение расхода Ozon Performance по SKU (асинхронные отчёты) | `ozon_ad_daily`, `ozon_ad_cache` | Ozon Performance API |
| `/api/sync/dashboard-cache?view=overview\|sales\|adverts\|stocks\|orders\|economy\|health` (×7) | сдвинутые 15-минутные тики | Прогрев кэша Ozon-кокпита по каждому экрану | кэш-снимки Ozon | Ozon Seller API |
| `/api/sync/commissions` | `15 * * * *` | Комиссии WB из финотчёта (Finance API, 1 запрос/мин), обход кабинетов по кругу | `wb_nm_commissions`, `wb_cabinet_commission_overhead` | WB Finance API |
| `/api/sync/rk-journal` | `0 3 * * *` | Ночной снимок журнала РК за вчера (ставка+метрики зафиксированы на дату) | `wb_rk_journal_daily` | — (агрегация из уже собранных таблиц) |
| `/api/sync/rk-autotask` | `20 3 * * *` | Автопроставление задач журнала РК (перенос вчерашнего решения / отключение по остатку) | `wb_rk_notes` | — |
| `/api/sync/screen-latency` | `30 4 * * *` | Замер времени ответа 7 ключевых экранов на каждом кабинете | `sync_log` (через `writeSyncLog`) | внутренние API-роуты панели |
| `/api/warehouse/kiz/nightly` | `10 4 * * *` | Ночной сбор кодов КИЗ на вывод из оборота — **только из своей БД**, в WB не ходит | `warehouse`-таблицы КИЗ | нет (специально спроектировано без внешних вызовов) |
| `/api/sync/kiz-codes` | `5,20,35,50 * * * *` | Добор кодов маркировки по сборочным заданиям (посуточное окно, ротация кабинетов) | КИЗ-таблицы | WB Marketplace API (`orders/meta` batch) |
| `/api/sync/token-health` | `15 6 * * *` | Проверка живости 7 категорий токенов WB на кабинет | `wb_token_health` | WB (пробные запросы по каждой категории) |
| `/api/opiu/monitor` | `0 5 * * *` | Финмониторинг ОПиУ: синк финотчёта WB, прогноз выплат, алерты, Telegram | `finance_alerts` | WB Finance API, Open-Meteo, Telegram |
| `/api/repricer/run/cron` | `30 6 * * *` | Прогон репрайсера по всем активным кабинетам | решения репрайсера | — (расчёт по своим данным) |
| `/api/signals?persist=1` | `40 6 * * *` | Классификация «узких мест» SKU (сигналы), запись не-OK в инсайты | `agent_insights` | — |
| `/api/adverts/rules/run` | `0 6 * * *` | Автоправила ставок: боевой прогон по всем кабинетам, пишет ставки в WB | `advert_bid_changes`, `advert_rule_runs` | **WB Advert API — `PATCH /api/advert/v1/bids` (запись!)** |
| `/api/ctrtest/rotate` | `*/5 * * * *` | Автосмена варианта обложки в CTR-тесте (пишет фото в карточку WB) | `ctr_tests`, `ctr_test_rounds` (RPC) | **WB Content API — замена обложки карточки (запись!)** |

Из 31 записи — **две реально изменяют состояние на стороне WB** (`adverts/rules/run` меняет ставки, `ctrtest/rotate` меняет фото карточки), остальные — чтение WB/Ozon/внешних API и запись в свою БД.

### Кроны, объявленные, но не подключённые к расписанию
- `app/api/sync/all-2/route.ts` — джобы `commissions, feedbacks, ozon-adverts` параллельно; в `vercel.json` записи нет, и нигде в коде этот роут не вызывается (`grep` не нашёл ссылок). Похоже на осиротевший второй слот — комментарий в `all/route.ts:6-13` описывает историю его появления, но фактически все три джобы уже покрыты отдельными top-level кронами (15/10/25 минут), так что дублирования функциональности нет — просто мёртвый эндпоинт.
- `app/api/sync/watchdog/route.ts` — намеренно НЕ крон Vercel: это точка входа для **внешнего** watchdog-сервиса, защищённая отдельным `SYNC_WATCHDOG_SECRET` (см. §4).
- `app/api/sync/moysklad/route.ts` (healthcheck МойСклад) — не в списке кронов; вызывается только вручную через `/api/sync/trigger?job=moysklad` (`app/api/sync/trigger/route.ts:11`). **Автоматической проверки токена МойСклад нет.**
- `app/api/sync/orders`, `adverts`, `advert-stats`, `fbs-orders` — не отдельные top-level кроны, а вызываются изнутри `/api/sync/all` через `runCoreSyncJobs` (`lib/sync/orchestrator.ts:2-3`).

---

## 2. Внешние сервисы

### 2.1 Wildberries (основной поставщик данных)
Хосты (`grep` по `lib/wb/*`): `statistics-api`, `seller-analytics-api`, `marketplace-api`, `advert-api` (+`advert-api-sandbox`), `content-api`, `discounts-prices-api`, `feedbacks-api`, `finance-api`, `common-api`, `returns-api`, `supplies-api`, `search.wb.ru`, `www.wildberries.ru`.

- **Env**: `WB_STATS_TOKEN`, `WB_TOKEN_STATISTICS`, `WB_TOKEN_CONTENT`, `WB_TOKEN_ADVERT`, `WB_TOKEN_FEEDBACKS` — глобальные дефолты; per-кабинет токены хранятся в БД (`wb_cabinets`), резолвятся через `resolveWbToken()` (`lib/wb/cabinetTokens.ts`, используется во всех sync-роутах).
- **Категории (scope) токена** проверяются кроном `token-health`: `statistics, marketplace, analytics, advert, content, prices, feedbacks` (`app/api/sync/token-health/route.ts:11`).
- **Экраны, зависящие от WB**: РНП, Воронка, Реклама/Журнал РК, ABC, Юнит-экономика, Полки, Склад/КИЗ, Поставки, Отзывы, СЕО — фактически весь WB-контур панели.
- **Что видит пользователь при протухшем/недоступном токене**:
  - В `/wb/health`-данных (`app/api/wb/sync-health/route.ts`) — по каждой категории токена: `available`, `expiresAt`, `daysLeft`, `lastError` с человекочитаемой меткой (`WB_SCOPE_LABEL`).
  - На уровне кабинета (`app/api/operational-health/route.ts:155-161`) — чек `wb-cabinet`: `error`, если основной токен пуст.
  - На уровне общей готовности WB-кэша (`lib/sync/wbCacheReadiness.ts:20-40`) — джоба считается `missing/failed/stale`, если `sync_log` не даёт свежей `ok`-записи за 90 минут.
  - Экраны, использующие устаревшие данные, **не блокируются** — они продолжают показывать последний успешный снимок (комментарий про «ОПиУ продолжает работать на последнем успешном снимке», `app/api/opiu/monitor/route.ts:55`), пользователь видит это косвенно через раздел здоровья, а не как ошибку на самом экране.
- **Rate limit**: общий «глобальный лимитер» WB (429 с телом `Limited by global limiter` или пустым телом) распознаётся хелпером `isWbGlobalRateLimit()` (`lib/wb/rateLimit.ts:1-9`) и в большинстве кронов трактуется как «отложено», а не «ошибка» — не красит `sync_log` в error, просто откладывает до следующего тика (см. напр. `app/api/sync/sales/route.ts:103-127`, `app/api/sync/stocks/route.ts:87-101`).
- Отдельный особый случай — **Finance API** (комиссии, платное хранение): жёсткий лимит **1 запрос в минуту**, поэтому кроны `commissions` и `paid-storage` держат `maxDuration=300` и постранично сохраняют курсор в `wb_sync_state`, чтобы не терять прогресс между запусками (`app/api/sync/commissions/route.ts:16-19`).

### 2.2 Ozon Seller API + Ozon Performance (реклама)
- Хосты: `api-seller.ozon.ru` (`lib/ozon/api.ts:4`), `api-performance.ozon.ru` (`lib/ozon/performance.ts:2`).
- **Учётные данные хранятся в БД** (`wb_cabinets`: `client_id/api_key` для Seller, `perf_client_id/perf_secret` для Performance), а не в env — env-переменных для Ozon нет вообразимо, всё per-кабинет.
- Авторизация: заголовки `Client-Id` + `Api-Key`, через `ozonSellerFetch` — «ворота кабинета», так как **Ozon считает лимит по Client-Id целиком** (`lib/ozon/api.ts:29-31`).
- **8 сентября 2026 Ozon отключил** `/v3/finance/transaction/totals` и `/v3/finance/transaction/list` (комментарий `lib/ozon/api.ts:76-80`) — валидация ключа была переделана на дешёвый `/v3/product/list`, чтобы не зависеть от того, какой конкретно отчёт «жив» сегодня — прямое свидетельство хрупкости контракта с Ozon.
- Экраны: весь `/ozon/*`-кокпит (overview, sales, adverts, stocks, orders, economy, health), прогревается 7 отдельными кронами по вьюхам.
- Отчёты Performance асинхронные (создание задачи → поллинг → скачивание), с ограничением на количество одновременных отчётов и восстановлением состояния между запусками (`PerfProductReportResumeState`, `app/api/sync/ozon-adverts/route.ts:34-40`).
- При недоступности Ozon пользователь на `/ozon/health` видит статус проверки; специфической деградации типа «баннер ошибки на каждом экране» не найдено — экраны читают кэш (`ozon_ad_cache`/`ozon_ad_daily`) и просто показывают последний обновлённый снимок.

### 2.3 MPSTATS (маркетная аналитика)
- Хост: `mpstats.io/api/analytics/v1/wb` (`lib/mpstats/client.ts:6`). Env: `MPSTATS_TOKEN`.
- Продуманная обработка ошибок: `MpstatsApiError` с кодами `auth/rate_limit/upstream/network`, retry с уважением к `Retry-After` (до 4 попыток на POST, 3 на GET), явные HTTP-статусы наружу через `mpstatsRouteError()` (`lib/mpstats/client.ts:26-37`).
- **Если токен не задан — функции просто возвращают `null`/`[]`, без исключения** (`hasMpstats()`, `token()` — `lib/mpstats/client.ts:9-11, 39-41`) — то есть отсутствие интеграции деградирует тихо, экраны рынка/планирования показывают пустые ниши без явного предупреждения пользователю (нужно смотреть код экрана `/market`, `/planning`, чтобы подтвердить, показывается ли там баннер — из просмотренного клиента такого баннера в самом клиенте нет).
- Экраны: `/market/niches`, `/market/pulse`, `/planning/skus` (сезонность продаж).
- Известное качество данных: «MPStats занижает ~×2.3 по продажам — для НАПРАВЛЕНИЯ, не абсолюта» (комментарий, `lib/mpstats/client.ts:3`).

### 2.4 Google Sheets / Google Drive
- **Google Sheets** (`sheets.googleapis.com`) — двусторонний экспорт ОПиУ/платёжного календаря в таблицу через service account (`lib/opiu/googleSheetsDirect.ts:4-5`, дефолтный `spreadsheetId` захардкожен как fallback). Env: `GOOGLE_SERVICE_ACCOUNT`/`GOOGLE_SERVICE_ACCOUNT_B64`, `FINANCE_SPREADSHEET_ID`, а также опциональный legacy-путь через Apps-Script webhook (`FINANCE_GOOGLE_SHEETS_WEBHOOK_URL`, `FINANCE_GOOGLE_SHEETS_SECRET`).
  - Вызывается только вручную (кнопка экспорта, `app/api/opiu/google-sheets/route.ts`), в кронах не участвует.
  - Есть fallback-цепочка: если задан webhook, но он не ответил `ok`/упал сетью — код тихо переключается на прямую запись через service account (`syncDirectly()`, `app/api/opiu/google-sheets/route.ts:91-109`) — то есть отказ старого Apps-Script транспорта скрыт от пользователя, просто используется другой путь.
- **Google Drive** (`www.googleapis.com`, `oauth2.googleapis.com`) — используется для фото моделей в Lab/UGC-модуле (`app/api/lab/drive-img/[id]/route.ts`, `app/api/lab/gfolder-validate/route.ts`), не в кронах.

### 2.5 Telegram — **две независимые интеграции**
1. **Финансовый бот ОПиУ** (`lib/opiu/telegramBot.ts`) — env `FINANCE_TELEGRAM_BOT_TOKEN`, `FINANCE_TELEGRAM_CHAT_ID`, `FINANCE_TELEGRAM_WEBHOOK_SECRET`. Двусторонний: шлёт алерты (крон `opiu/monitor`), критичные — только если алерт новый (`app/api/opiu/monitor/route.ts:52-77`); принимает команды и ответы по платежам через вебхук (`app/api/opiu/telegram/route.ts`), с `forceReply` для уточнений. Используется модулем «Деньги»/банковские выписки.
2. **Контентный постинг** (`app/api/post/telegram/route.ts`) — env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL` — публикация в канал, отдельно от финансов, ручной вызов (не крон).
- Если `FINANCE_TELEGRAM_BOT_TOKEN` не настроен — `sendTelegramMessage()` **бросает исключение** (`lib/opiu/telegramBot.ts:13`); в кроне `opiu/monitor` это исключение проглатывается верхним `try/catch` и превращается в общий 500 с текстом ошибки (`app/api/opiu/monitor/route.ts:104-109`) — то есть весь финмониторинг за день падает целиком, если не настроен Telegram, а не просто «сигнал не отправлен».

### 2.6 VK
- `api.vk.com/method/wall.post` — постинг в сообщество (`app/api/post/vk/route.ts`). Env: `VK_TOKEN`, `VK_GROUP_ID`. Ручной вызов, относится к контентному модулю (не финансово-складской контур), видео пока не поддержано — только текст+ссылка.

### 2.7 Higgsfield (AI-генерация для UGC)
- Хост: `platform.higgsfield.ai` (`lib/ugc/task.ts:4`). Env: `HF_CREDENTIALS` (единая пара credentials, не разделена по ролям — см. память `comfy-runtime-role-credentials-live`: «старый общий secret = 401» — известная проблема с общими секретами в соседних AI-пайплайнах, стоит перепроверить, не тот ли это паттерн). Используется в Lab/UGC (`app/api/lab/*`, `app/api/ugc/generate`), не в кронах.

### 2.8 fal.ai
- `queue.fal.run/fal-ai/flux/dev` — генерация AI-модели для сцен (`lib/fal/pulid.ts:3`). Env: `FAL_KEY`. Ручной, для Lab.

### 2.9 LLM-провайдеры (Anthropic + Polza как fallback)
- **Anthropic** — `lib/agent/client.ts:1-37`, модель из `ANTHROPIC_MODEL`; используется агентом WB/Ozon (`app/api/agent/route.ts`), распознаванием банковских выписок (`lib/finance/bankStatementPdf.ts`), распознаванием кредитных документов (`lib/loans/aiRecognition.ts`), Telegram-парсингом ответов (`app/api/opiu/telegram/route.ts`), генерацией промптов Lab (`lib/lab/genPrompt.ts`), сценариев UGC (`lib/ugc/script.ts`).
  - Важная деталь инфраструктуры: комментарий в коде утверждает, что **на текущей машине прямой доступ к `api.anthropic.com` заблокирован**, выход только через `AGENT_PROXY_URL`/`HTTPS_PROXY`/`HTTP_PROXY` с ручным `undici.ProxyAgent` (`lib/agent/client.ts:4-9`) — это похоже на ограничение конкретной среды разработки/деплоя, но стоит убедиться, что в проде (Vercel) эта прокси-обвязка не мешает и не требуется, иначе `createClaudeClient` может не создать клиента вовсе.
- **Polza** (`POLZA_API_KEY`/`POLZA_AI_API_KEY`, модель `openai/gpt-4o` по умолчанию через `POLZA_MODEL`) — резервный OpenAI-совместимый шлюз для распознавания банковских выписок и кредитных документов (`lib/finance/bankStatementPdf.ts:178-184`, `lib/loans/aiRecognition.ts:132-179`). Явно спроектирован как fallback: «Основной ИИ-сервис недоступен, а резервный POLZA_API_KEY пока не настроен» (`lib/loans/aiRecognition.ts:179`) — то есть отсутствие обоих ключей даёт понятную ошибку пользователю, а не тихий сбой.
- Отдельные модели для банковских выписок: `BANK_STATEMENT_ANTHROPIC_MODEL`, `BANK_STATEMENT_ACCURATE_MODEL` (`lib/finance/bankStatementPdf.ts:218-219`).

### 2.10 Яндекс (Диск)
- `cloud-api.yandex.net/v1/disk/public/resources` — публичное (без авторизации, read-only) чтение расшаренных папок как источник контента (`lib/yandex/disk.ts:1-9`). Env: `YANDEX_PUBLIC_KEY`. Относится к контентному/UGC-модулю, не к финансово-складскому контуру. При сетевой ошибке или отсутствии ключа функции просто возвращают `[]` — тихая деградация без сигнала пользователю (`lib/yandex/disk.ts:15, 28`).

### 2.11 МойСклад
- Хост: `api.moysklad.ru` (`lib/moysklad/api.ts:3`). Токен хранится **в БД** на кабинет (`moysklad_connection`), не в env.
- Интеграция — **только валидация токена и чтение справочников юрлиц/складов** (`getMoySkladContext`, `app/api/moysklad/route.ts:60-64`); товарооборот/ассортимент не импортируется («Не импортирует ассортимент и не может смешать аккаунты», комментарий `app/api/sync/moysklad/route.ts:8-9`).
- Единственный автоматический процесс — здоровье подключения, **но он не запланирован ни в одном кроне** (см. §1) — то есть протухший токен МойСклад обнаружится только когда пользователь сам зайдёт на `/wb/supplies` и увидит статус `error`/`warning` в блоке `operational-health` (`app/api/operational-health/route.ts:191-198`), либо вручную дёрнет `/api/sync/trigger?job=moysklad`.

### 2.12 Честный знак / маркировка
- **Прямой интеграции с ГИС МТ «Честный знак» (True API, `markirovka.crpt.ru`) в коде нет.** Все упоминания «КИЗ»/маркировки идут через **собственные API Wildberries** — коды сборочных заданий (`lib/wb/kizCodes.ts`, `lib/wb/kizReconcile.ts`, `lib/wb/kizWithdrawal.ts`) и `wb_fbs_order_kiz`. Это подтверждает и память проекта («Контур ЧЗ в Поставках — True API отложен осознанно», `docs/`). Т.е. панель не читает статусы кодов маркировки напрямую у оператора ЧЗ, а реконструирует их из данных WB — риск: если WB перестанет отдавать эти поля или изменит форму ответа, прямой альтернативы у панели нет.

---

## 3. Механизмы здоровья

| Механизм | Роут | Что показывает |
|---|---|---|
| **sync-log** | `app/api/sync-log/route.ts` | Плоский журнал последних 100 записей `sync_log` (job/status/rows_affected/error/started_at/finished_at) — сырой лог для UI `/sync`. |
| **watchdog** | `app/api/sync/watchdog/route.ts` | SLA-проверка по 8 джобам (`sales, stocks, feedbacks, funnel, adverts, orders, commissions` — 130 мин; `token-health` — 36 ч), см. `lib/sync/watchdogHealth.ts:1-10`. Возвращает `ok/issues` с типами `missing/failed/stale/invalid_timestamp`. **Защищён отдельным `SYNC_WATCHDOG_SECRET` (или `CRON_SECRET`) и НЕ вызывается изнутри Vercel Cron** — предназначен для внешнего мониторинга (`proxy.ts:33`: «внешний watchdog: сам роут проверяет узкий SYNC_WATCHDOG_SECRET»). Если внешний вызывающий (например, UptimeRobot/Cronitor) не настроен, эта проверка вообще не срабатывает — сама по себе конструкция не гарантирует, что кто-то её дёргает. |
| **token-health** (крон) | `app/api/sync/token-health/route.ts` | Раз в сутки (06:15 МСК) пробует все 7 категорий scope на каждом кабинете, пишет `wb_token_health` (available/expires_at/days_left/last_error). |
| **operational-health** | `app/api/operational-health/route.ts` | На кабинет: состояние заказов/поставок, чек-лист (`wb-cabinet, orders, sales, stocks, funnel, moysklad, wms, receiving`), алерты по просроченным поступлениям/пустому товарному контуру, общий `healthScore`. Сверяет «заявленное» (`wb_sync_state.status`) с «фактическим» (реальная свежесть данных в `wb_orders`/`wb_sales` через `syncFactVerdict`, `lib/health/syncFacts.ts`) — то есть отдельно ловит случай «крон отчитался ok, но данные на самом деле не обновились». |
| **wb/sync-health** | `app/api/wb/sync-health/route.ts` | Самый подробный: по каждому кабинету — 8 источников (`orders, sales, stocks, adverts, advert-stats, funnel, feedbacks, commissions`) со своим SLA в минутах (`SOURCE_SLA_MINUTES`, 90–1560 мин), статус токенов по 7 категориям, покрытие полей (`price_with_disc`, `spp` — доля заполненности), плюс **более десятка скрытых диагностических режимов** через query-параметры (`?campaign_layer=1`, `?spend_split=1`, `?cabinet_gap=1`, `?db_latency=1`, `?scoped_rows=1` и др.) — узкоспециализированные зонды, оставленные после разбора конкретных инцидентов (расхождение расхода рекламы по SKU, задержка БД Сидней↔Франкфурт и т.д.). Экран `/wb/health` **редиректит** на `/wb/rnp` (`lib/wb/retiredRoutes.ts:8`) — то есть общедоступной агрегированной страницы под этим URL больше нет, данные `wb/sync-health` нужно смотреть через другой встроенный интерфейс/вручную по API. |
| **screen-latency** (крон) | `app/api/sync/screen-latency/route.ts` | Раз в сутки бьёт 7 ключевых экранов на каждом кабинете, пишет в тот же `sync_log`, чтобы деградация (500 или >5с) была видна без отдельной инфраструктуры — прямая реакция на инцидент, когда «РНП месяцами отдавал 500 на двух кабинетах», и никто не заметил (комментарий `app/api/sync/screen-latency/route.ts:6-11`). |

---

## 4. Системные риски

**Молчаливые сбои (уже чинившиеся, задокументированные в коде — показатель зрелости, но и хрупкости):**
- `ctrtest/rotate` полтора суток бился в 405, потому что роут был объявлен только `POST`, а планировщик Vercel зовёт крон исключительно GET-ом — тест владельца простоял 29 часов без единого переключения, и ничего не записалось в журнал вовсе (`app/api/ctrtest/rotate/route.ts:66-78`). Это системный класс риска: **любой будущий крон, случайно объявленный без экспорта `GET`, будет молча игнорироваться платформой** — 404/405 не долетает до `checkCronAuth`/`writeSyncLog`.
- Пустой ответ WB по продажам раньше двигал курсор вперёд и помечал «100% догнано» — пропущенные дни продаж переставали собираться навсегда, при этом возвраты по тем же дням продолжали приходить, создавая отрицательные выкупы в РНП (`app/api/sync/sales/route.ts:144-150`). Сейчас исправлено явной проверкой `nothingCollected`/`allDeferred`.
- Финотчёт комиссий: если после успешной пагинации `comm.byNm.size === 0`, это трактуется как ошибка, а не «ok, но пусто» (`app/api/sync/commissions/route.ts:176-178`) — специально, чтобы нулевой результат не выглядел как успех.
- `writeSyncLog` сама по себе раньше не проверяла ошибку записи в `sync_log`, из-за чего экран `/sync` врал об «остановке» синка, когда данные на деле шли (исправлено ретраями, `lib/sync/helpers.ts:103-133`).
- Ozon-бэкфилл истории рекламы: счётчик «зависшего» заказа раньше сбрасывался на любом незавершённом заходе, включая частично успешные — кабинеты стояли по несколько дней без прогресса, разнесение расхода по товарам не наполнялось (исправлено логикой `misses`, `app/api/sync/ozon-adverts/route.ts:88-105`).
- Крон `paid-storage`: если между «создали задачу» и «проверили статус» проходит целый час (следующий тик), а отчёт WB «протухает» (purged) быстрее часа, бэкфилл застревал навсегда на первом окне — исправлено тем, что создание и первая проверка статуса теперь в одном вызове (`app/api/sync/paid-storage/route.ts:80-87`).

**Отсутствие ретраев / встроенные ретраи:**
- `chunkedUpsert` и `writeSyncLog` **делают до 3 попыток** при транзиентной ошибке (`fetch failed`) с задержкой 1–2с (`lib/sync/helpers.ts:39-54, 127-132`) — то есть на уровне записи в БД ретраи есть.
- На уровне внешних API ретраи неравномерны: у MPSTATS есть полноценный retry с уважением `Retry-After` (до 4 попыток); у WB retry как таковой почти не применяется — вместо повторной попытки внутри одного вызова синки просто **откладывают весь батч на следующий тик крона** через механизм `deferred`/`wb_sync_state`, что фактически и есть ретрай, но с гранулярностью в час (или чаще для `kiz-codes`/`ozon-adverts` — раз в 15 минут).
- Финансовый Telegram-бот (`sendTelegramMessage`) не ретраит и **бросает исключение**, если токен не настроен — единственная точка, где сбой одной интеграции (Telegram) валит весь `opiu/monitor` (синк финотчёта + прогноз + анализ) целиком за прогон, а не только уведомление (`app/api/opiu/monitor/route.ts:20-109`).

**Лимиты, о которых явно знает код:**
- WB Finance API — 1 запрос/минуту (комиссии, платное хранение).
- WB Advert API bids — 5 запросов/сек на продавца, панель держится вдвое ниже (400мс пауза, `app/api/adverts/rules/run/route.ts:14-17`).
- WB warehouse_remains — 1 задача/мин на аккаунт.
- WB — общий «глобальный лимитер» на продавца (не на кабинет), из-за чего у агентских кабинетов (Оптима) с десятками саб-брендов один кабинет может «съедать» лимит у всех остальных — отсюда специальная группировка `groupWbStatisticsTargets`.
- Ozon Performance — 1 отчёт в минуту на клиента, плюс отдельный rate limit на создание отчёта (обрабатывается retry с задержкой 20-30с).
- MPSTATS — 429 с уважением `Retry-After`; лимит квоты 10k WB-вызовов упомянут в комментарии (`lib/mpstats/client.ts:4`).

**Прочие структурные риски:**
- `checkCronAuth` пропускает проверку целиком при отсутствии `CRON_SECRET` — риск конфигурации, не кода.
- МойСклад: единственная проверка здоровья интеграции не запланирована ни в одном кроне — токен может протухнуть незаметно до ручного захода на экран.
- Общий секрет Higgsfield (`HF_CREDENTIALS`) не разделён по ролям — по аналогии с уже встречавшейся в соседнем контент-пайплайне проблемой «общий secret = 401», стоит проверить, не тот же ли это паттерн уязвимости к откату/ревокации.
- `/api/sync/all-2` — мёртвый, никем не вызываемый роут; не риск сам по себе, но источник путаницы при последующих правках (кто-то может решить, что он часть расписания).
- Ozon Seller API периодически отключает используемые панелью методы без объявленного deprecation-цикла (прецедент 8 сентября 2026 с финансовыми эндпоинтами) — интеграция построена так, чтобы не зависеть от одного метода для критичной операции (валидации ключа), но для остальных отчётов (экономика, финансы) такой отказоустойчивости в прочитанном коде не встречено явно.