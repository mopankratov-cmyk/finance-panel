# Разработка ассортимента — карта интеграции (этап 0)

ТЗ: `docs/tz/assortment-development-tz-v3.md` (версия 3.0 от 01.10.2026), приложение —
`docs/tz/assortment-development-sources.xlsx`. Источники и пробы доступа — в
`docs/assortment-development-sources.md`.

Состояние на 01.10.2026, проверено по `main` @ `6aa9c8a5`. На этапе 0 код приложения
не менялся: документ фиксирует, куда модуль встраивается, что переиспользуется и
что предстоит сделать на этапе 1.

## 1. Границы, принятые в ТЗ v3

- Отдельный пункт меню «Разработка ассортимента», внутри ровно два раздела:
  «Куртки» (NORVIA/HEATON) и «Сумки» (CLÉRIN).
- В модуле нет цен, валют, себестоимости, маржи, СПП, бюджетов и MOQ — ни в схеме,
  ни в API, ни в интерфейсе, ни в экспорте. Цены, которые приходят из источников
  (Shopify `products.json`, атрибут `data-ga` у Charles & Keith), выбрасываются на
  границе адаптера, до записи в базу.
- Модуль не вызывает Ozon и MPSTATS-Ozon.
- `/market`, `/wb/market`, `/api/market/niches`, `/api/market/pulse` не трогаются.
- Второй справочник поставщиков, калькулятор и словарь ролей не заводятся.
  Действуют организация, кабинеты и матрица из 10 ролей.
- «PVB» означает «по ВБ», отдельной сущности нет.

## 2. Маршруты и меню

Имена свободны: `app/assortment-development`, `app/api/assortment-development`,
таблицы `assortment_*` в коде и миграциях не встречаются. Слово «assortment»
есть только в WMS/МойСклад и с модулем не пересекается.

| Что | Где | Что сделать на этапе 1 |
|---|---|---|
| Страницы | `app/assortment-development/{jackets,bags}/page.tsx` | Корень `/assortment-development` открывает последний выбранный раздел. Запоминать на клиенте, по умолчанию «Куртки». |
| API | `app/api/assortment-development/...` | Короткие запросы. Тяжёлое — через очередь заданий (§7). |
| Главное меню | `components/Sidebar.tsx`, `NAV_GROUPS` (стр. 67–131) | Новая группа «Разработка ассортимента» с двумя пунктами. Скрытие по ролям уже идёт через `allowedNav(role, href)`. |
| Выбор набора меню | `lib/navigation/sidebar.ts` | Новый путь не входит в FINANCE/SYSTEM/AGENT, поэтому получит полный `NAV_GROUPS`. Правка не нужна. |
| Оболочка | `components/AppLayout.tsx:27` | `/assortment-development` идёт через общий `Sidebar`. Правка не нужна. |
| Плитки модулей (по желанию) | `components/ModuleMenu.tsx:8`, `components/dashboard/ModulesHome.tsx:31-37` | Добавить плитку после этапа 1. |
| Мобильный вид | `docs/MOBILE-ADAPTATION.md` §6 | До 1024 px меню — шторка. Галерея: 1–2 карточки в ряд на телефоне, 3–5 на широком экране. |

## 3. Доступ

Роли (`lib/auth/permissions.ts:102`): director, fin_director, financier, hr,
wb_manager, ozon_manager, buyer, warehouse, seller_owner, seller.

Что править:

1. `lib/auth/roles.ts` — добавить `/assortment-development` в списки путей ролей,
   которым модуль открыт. У director уже `["*"]`.
2. `lib/auth/apiPermissions.ts`, `RULES` — строка
   `["/api/assortment-development/", { read, write }]`. Без неё прокси отдаёт 403.
   Тест `tests/api-permission-map.test.mts` падает, если новый `route.ts` не описан
   в карте.
3. `proxy.ts` (стр. 208–302): одиночные роли ozon_manager, warehouse и seller
   проходят только по узким спискам. Если модуль им не нужен, ничего не трогаем.
4. Внутри маршрута — `requireApiSession(roles)` из `lib/auth/apiGuard.ts`.
   Машинный доступ сборщика — отдельный Bearer-секрет (§7), не сессия.
5. Журнал действий: `access_audit_log` через `lib/audit/log.ts`
   (`audit()`, `auditedMutation()`). `AuditAction` — закрытый список, нужны новые
   метки: `assortment.import`, `assortment.decision`, `assortment.export`,
   `assortment.collection`.

**Решение владельца (вопрос 1):** кому открыть модуль. Предложение:
director — всё; buyer и wb_manager — чтение и работа с подборками;
внешним ролям (seller_owner, seller) — закрыт. Готовые права для `RULES`:
`analytics.view` на чтение и `catalog.edit` на запись.

## 4. Направления, организации и кабинеты

Отдельной таблицы брендов или «направлений» нет. Соответствие бренд → кабинет →
юрлицо записано только константами в коде:
`lib/opiu/constants.ts:28-92` (`OPIU_BRANDS` с `articlePrefixes`,
`OPIU_LEGAL_ENTITIES`), `lib/wb/productScope.ts:6-7`, `wb_cabinets.brand_filters`.
Префиксы артикула: `NV-` → Norvia, `HT-` → Heaton, `ESC` → Riobox
(`lib/finance/balanceWbCatalog.ts:31-33`).

| Направление | Бренды | Кабинет (по коду) | Юрлицо (по коду) |
|---|---|---|---|
| Куртки | Norvia, Heaton | Retail Family; Оптима (агентский) | ИП Филиппов (entity «Retail Family») |
| Сумки | CLERIN | CLERIN | ИП Кучеренко |

Таблица `brand_kits` (`20260622_brand_kits.sql`) в TS-коде не используется.

Предложение для этапа 1: небольшая таблица `assortment_directions`
(`code`: jackets | bags, бренды, `organization_id`) и поле `direction` у каждой
записи модуля. Проверка доступа идёт по организации пользователя
(`lib/auth/cabinetAccess.ts`), направление работает как фильтр, а не как право.
Зарубежные референсы ни к какому кабинету не привязаны, это общий справочник
внутренней организации.

## 5. Данные (минимальные миграции этапа 1)

Логические объекты из ТЗ §9. Отдельная таблица на каждое название не нужна.
Ни в одной таблице нет полей цены, валюты и экономики.

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `assortment_sources` | Паспорт источника, ID S001–S127 из реестра | `source_id`, `adapter_type`, `access_status`, `capabilities` (jsonb: discovery / item_details / images / videos / public_metrics / historical_metrics / export → supported / unsupported / untested), `seed_urls`, `allowed_fields`, `media_policy`, `refresh_schedule`, `last_success_at`, `parser_version` |
| `assortment_references` | Модель товара | `direction`, `source_id`, `region`, `source_item_id` либо нормализованный URL (уникальный ключ), `article`, `title`, `url`, `first_seen_at`, `published_at`, `last_seen_at`; признаки (jsonb) с отметкой источника и уверенности |
| `assortment_media` | Фото и кадры | `reference_id`, `storage_path`, `origin_url`, `sha256`, `phash`, `width`, `height`, права и правила удаления |
| `assortment_observations` | Наблюдения и доказательства (только дополняются) | `reference_id` / `publication`, `kind` (novelty / spread / retail), `value` либо null с причиной, `unit`, `period`, `region`, `method`, `status` (observed / retailer_claim / provider_estimate / forecast / manual), `observed_at`, `collected_at` |
| `assortment_collections` + `_items` | Подборки, доска курток, «5 сумок + резерв» | `direction`, `period`, `version`; у позиции — `status`, причина замены |
| `assortment_decisions` | Решения и версии задания | `reference_id` / `collection_id`, `decision`, `version` (защита от одновременной правки), `author`, снимок задания для экспорта |
| `assortment_jobs` | Очередь сборщика (§7) | `kind`, `payload`, `status` (queued / running / succeeded / failed), `lease_until`, `heartbeat_at`, `attempts`, `next_run_at`, `idempotency_key` |

Плюс приватный бакет `assortment-media`. Права: RLS включён, у anon и
authenticated прав нет, доступ только через `service_role` и серверные маршруты.
Если таблицу нужно сделать неизменяемой (журнал наблюдений), одного GRANT мало:
Supabase по умолчанию раздаёт `service_role` все права на новые таблицы, поэтому
сначала явный `revoke all ... from service_role`, потом нужный `grant`.

Правила: история наблюдений только дополняется. Повторная загрузка не создаёт
дубль. Первый обход источника — исходная база, он не объявляет каталог
новинками. `first_seen_at` — дата первого наблюдения системой, а не дата выхода
товара.

## 6. Медиа и хранилище

| Бакет | Тип | Как сейчас | Годится для модуля |
|---|---|---|---|
| `factory-media` | публичный | `getPublicUrl` (`app/api/content/upload`) | нет: фото референсов не должны быть публичными |
| `finance-loan-documents` | приватный | `ensurePrivateBucket`, `createSignedUrl` на 120 с после проверки ролей | **да, образец** |
| `finance-uploads` | приватный | `createSignedUploadUrl` (`lib/finance/uploadStorage.ts`) | да: так mini загружает фото, минуя Vercel |

Vercel не принимает тело запроса больше ~4,5 МБ. Поэтому сборщик отправляет в
панель только метаданные и хэши, а файлы кладёт в хранилище по подписанной
ссылке на загрузку. Перцептивный хэш нужен для склейки копий одного фото.
Семантическим поиском силуэтов он не считается. `pgvector` в базе нет и на
этапе 1 не вводится.

## 7. Задания и сборщик

Готовой очереди нет: `wb_sync_state` с `claim_wb_sync_job` рассчитана на курсор
синка WB, `render_jobs` и `batch_builds` в коде не используются. Предложение по
ТЗ §10: таблица `assortment_jobs` и RPC атомарного захвата с `lease_until`,
`heartbeat_at` и `attempts`. Просроченная аренда уходит на повтор, обработчик
идемпотентен.

Где работает:

- **Vercel** — интерфейс и короткие API. 38 cron-задач уже есть; модулю нужен
  максимум один лёгкий крон «поставить обходы в очередь», и то не обязательно.
- **mini** — обход каталогов и обработка картинок. Отдельная LaunchAgent-задача,
  Node: на нём уже оба сборщика. Схема доставки как у полок и выплат:
  `GET` задания, `POST` результатов с `Authorization: Bearer <секрет>`.
  Секрету нужно новое имя переменной, например `ASSORTMENT_COLLECTOR_SECRET`.
  Создаёт его владелец в Vercel и на mini, в репозиторий секрет не попадает.
- **Пульс обязателен.** Сборщик полок с 21.09 по 01.10 девять дней не доставлял
  данные (907 ошибок `fetch failed`), и это никто не заметил. У модуля в панели
  должны быть видны время последнего успешного обхода по каждому источнику и
  тревога при пропуске.

Состояние mini на 01.10.2026: M4 Pro, 12 ядер, 24 ГБ, свободно 366 ГБ, сон
выключен, автозапуск после сбоя питания. Node 22 в `~/opt/node/bin`, Python
только системный 3.9 без библиотек, полного ffmpeg нет. Выход в интернет идёт
через VPN с гонконгским адресом. Окно для обхода — 01:00–07:00 МСК, чтобы не
пересекаться со слотами полок (10:00, 18:00, 22:00) и выплат. Для Shopify-
каталогов браузер не нужен: хватает HTTP. Библиотеки для картинок (sharp) и
ffmpeg — это правка `package.json` и установка на mini, обе на одобрение
владельца.

## 8. ИИ

- Модель задаётся в `lib/ai/models.ts` (`ANTHROPIC_MODEL`), клиент — в
  `lib/agent/client.ts` (`createClaudeClient`). Через него работают CTR-анализ
  фото и раздел «Лаборатория».
- Polza (`POLZA_API_KEY`, `POLZA_MODEL`) подключена только в
  `lib/loans/aiRecognition.ts` (сначала Anthropic, при ошибке Polza) и в
  `lib/finance/bankStatementPdf.ts` (оба параллельно). Общей обёртки с
  переключением на резервный сервис нет.
- **С mini Anthropic недоступен:** `api.anthropic.com` отвечает 403 через
  гонконгский выход. Polza с mini отвечает за 0,08 с. Значит, извлечение
  признаков нужно запускать на Vercel. С mini — только через Polza.
- **Сравнение Anthropic и Polza на одних и тех же изображениях не проводилось.**
  Наличие ключей не считается успешной проверкой. План на этапе 1: служебный
  маршрут (только director) прогоняет 10 фото курток и сумок через оба сервиса по
  одной JSON Schema признаков и сохраняет оба ответа и время. Без этого
  результата ИИ-признаки в интерфейсе не включаются. Ручные признаки, галерея и
  подборки работают и без ИИ.

## 9. MPSTATS

`lib/mpstats/client.ts` работает только с WB (`MPSTATS_TOKEN`). Используемые
методы картинок товаров не отдают: из `items/{nm}/full` берётся только subject.
Слой «Есть похожие на ВБ» необязателен по ТЗ, в этап 1 он не входит. Сначала
нужно проверить, какой метод MPSTATS отдаёт изображения, и не тянуть цены.

## 10. Что связывать, а не дублировать

| Существующее | Где | Связь с модулем |
|---|---|---|
| Поставщики, закупки | `suppliers`, `purchase_orders`, `app/api/suppliers`, `components/wb/WbSuppliersTab.tsx` | Из задания на разработку — ссылка «открыть в закупках». Внутри модуля закупки не реализуются. |
| Товары | `products`, `product_variants` | Когда идея станет нашим артикулом — ссылка на `products`. |
| Карточки WB | `wb_cards.photos*` | Сравнение «наша модель ↔ референс» (позже). |
| Контент | `content_assets` (поле `niche`: jackets / bags), `lib/content/productLibrary.ts`, `/wb/content` | Собственные фото образцов можно класть сюда и ссылаться. |

## 11. Порядок этапа 1 и оценка

Каждый PR показывает работу на реальных данных и даёт список ограничений.
Миграции применяет владелец.

1. **Схема и доступ.** Миграции из §5 и бакет; права (`roles.ts`,
   `apiPermissions.ts`, метки аудита); пустые страницы двух разделов в меню.
2. **Импорт и галерея.** Импорт URL и фото (с проверкой домена, размера, DNS и
   редиректов, запретом внутренних сетей); карточка референса; галерея;
   ручные признаки; доказательства; сравнение 2–6 моделей.
3. **Подборки и экспорт.** Подборки, «5 сумок + резерв», сезонная доска курток,
   решения с версией, экспорт задания (HTML для печати/PDF, CSV, JSON).
   Служебный тест ИИ из §8.

Оценка: этап 1 — три PR. Этап 2 (автоматический обход Shopify и
Charles & Keith на mini, очередь, пульс) — ещё два PR после согласования этапа 1.

## 12. Решения владельца

1. Кому открыть модуль (§3).
2. Секрет для сборщика на mini: имя переменной и кто его создаёт (§7).
3. Стартовые источники: замена недоступных Uniqlo, Mango, COS и Massimo Dutti
   на доступные (см. `assortment-development-sources.md`, §3). Включать ли
   DeMellier, у которого robots.txt запрещает автоматический сбор.
4. Pinterest: зарегистрировать приложение Pinterest для Trends API (OAuth,
   `user_accounts:read`). Ключи заводит владелец.
5. Установка sharp и ffmpeg на mini для обработки изображений (этап 2).
