import type { Permission } from "./permissions";

/**
 * Какое действие требует каждый эндпоинт.
 *
 * ТЗ по правам заканчивается строкой «закрытые данные нельзя получить через
 * прямую ссылку, API или выгрузку». Проверить это глазами нельзя: в панели
 * 261 роут, и своей проверки прав нет у большинства — они держатся на гейте
 * по путям, а гейт знает лишь несколько ролей. Поэтому появилась карта:
 * каждый роут обязан быть в ней назван, а тест падает и на неописанном
 * роуте, и на описании без роута.
 *
 * Карта — ещё не проверка. Она сначала должна быть полной и вычитанной, и
 * только потом включается в прокси: закрыть API по недосмотренной таблице
 * значит выключить работающие экраны живым людям.
 *
 * Правила разбираются от самого длинного пути к короткому, поэтому частный
 * случай можно писать рядом с общим и не следить за порядком строк.
 */

/** Почему роут живёт без права. */
export type OpenReason =
  /** Свой сторож: подпись, секрет крона, токен вебхука. */
  | "self-guarded"
  /** Только машина: cron Vercel или внутренний фан-аут по CRON_SECRET. */
  | "cron"
  /** Достаточно быть залогиненным: общий справочник или телеметрия экрана. */
  | "any-session";

export type ApiAccess =
  | { permission: Permission }
  | { read: Permission; write: Permission }
  | { open: OpenReason };

export type ApiRule = readonly [path: string, access: ApiAccess];

const READ_ANALYTICS = "analytics.view" as const;

/**
 * Пересчёт витрины — не изменение данных.
 *
 * Кнопки «обновить» шлют POST, но переписывают только кэш, собранный из уже
 * доступных чисел. Требовать за них право изменения значило бы закрыть
 * обновление тем, кому смотреть можно.
 */
const REFRESH: ApiAccess = { read: READ_ANALYTICS, write: READ_ANALYTICS };

const RULES: readonly ApiRule[] = [
  // ── Вход и сессия. Гейт их не видит вовсе (matcher исключает /api/auth). ──
  ["/api/auth/", { open: "self-guarded" }],

  // ── Синхронизации: расписание Vercel и внутренний фан-аут ──
  ["/api/sync/", { open: "cron" }],
  ["/api/sync/watchdog", { open: "self-guarded" }],
  ["/api/sync/screen-latency", { open: "any-session" }],
  ["/api/sync/trigger", { permission: "mp_reports.sync" }],
  ["/api/sync/history", { read: "mp_reports.view", write: "mp_reports.sync" }],
  ["/api/sync/token-health", { read: "mp_reports.view", write: "mp_reports.sync" }],
  ["/api/sync-log", { read: "mp_reports.view", write: "mp_reports.sync" }],

  // ── Финансы компании ──
  ["/api/finance/", { read: "finance.view", write: "finance.edit" }],
  ["/api/finance/payroll", { read: "payroll.view", write: "payroll.edit" }],
  ["/api/payroll", { read: "payroll.view", write: "payroll.edit" }],
  ["/api/payroll/", { read: "payroll.view", write: "payroll.edit" }],
  ["/api/opiu", { read: "finance.view", write: "finance.edit" }],
  ["/api/opiu/", { read: "finance.view", write: "finance.edit" }],
  // Вебхук Telegram, крон мониторинга и приёмник снимков браузерного сборщика
  // проверяют собственные секреты — сессии у них нет по устройству.
  ["/api/opiu/telegram", { open: "self-guarded" }],
  ["/api/opiu/monitor", { open: "self-guarded" }],
  ["/api/opiu/browser-payout-snapshots", { open: "self-guarded" }],
  // Отчёты маркетплейсов внутри ОПиУ — это уже другой раздел ТЗ (§14).
  ["/api/opiu/mp", { read: "mp_reports.view", write: "mp_reports.classify" }],
  ["/api/opiu/sync", { permission: "mp_reports.sync" }],
  ["/api/opiu/sync-report", { permission: "mp_reports.sync" }],
  ["/api/opiu/report-sync", { permission: "mp_reports.sync" }],
  ["/api/opiu/wb-payout-status", { read: "mp_reports.view", write: "mp_reports.sync" }],
  ["/api/opiu/margin", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  // Не склад, а строка склада В ОПиУ: роут пишет стоимость хранения в
  // финансовый отчёт. Первым заходом он был помечен складским правом — и
  // тест поймал, что так к ОПиУ получал доступ оператор фулфилмента.
  ["/api/opiu/warehouse", { read: "finance.view", write: "finance.edit" }],

  // ── Себестоимость ──
  ["/api/costs", { read: "cost.view", write: "cost.edit" }],
  ["/api/costs/categories", { read: READ_ANALYTICS, write: "cost.edit" }],

  // ── Учётные записи и настройки кабинетов ──
  ["/api/users", { read: "users.manage", write: "users.manage" }],
  ["/api/users/", { read: "users.manage", write: "users.manage" }],
  ["/api/users/cabinet-access", { permission: "users.roles.assign" }],
  ["/api/cabinets", { read: READ_ANALYTICS, write: "settings.manage" }],
  ["/api/cabinets/", { read: READ_ANALYTICS, write: "settings.manage" }],
  ["/api/cabinets/scopes", { read: READ_ANALYTICS, write: "settings.manage" }],
  // Внешний клиент подключает СВОЙ кабинет: роут сам держит границу организации.
  ["/api/cabinets/self-service", { open: "any-session" }],
  ["/api/cabinet-groups", { read: READ_ANALYTICS, write: "settings.manage" }],
  ["/api/cabinet-groups/", { read: READ_ANALYTICS, write: "settings.manage" }],
  ["/api/cabinet-settings/unit", { read: READ_ANALYTICS, write: "finance.edit" }],

  // ── Склад ──
  ["/api/warehouse/", { read: "warehouse.view", write: "warehouse.task.execute" }],
  ["/api/warehouse/entities", { read: "warehouse.view", write: "warehouse.view" }],
  ["/api/warehouse/balances", { read: "warehouse.view", write: "warehouse.view" }],
  ["/api/warehouse/stock", { read: "warehouse.view", write: "warehouse.view" }],
  ["/api/warehouse/events", { read: "warehouse.view", write: "warehouse.view" }],
  ["/api/warehouse/todo", { read: "warehouse.view", write: "warehouse.view" }],
  // Заявки: завести может и тот, кто их не подтверждает (§12.6).
  ["/api/warehouse/moves", { read: "warehouse.view", write: "warehouse.request.create" }],
  ["/api/warehouse/transfers", { read: "warehouse.view", write: "warehouse.request.create" }],
  // Подтверждение чужого документа и правка учётного остатка — разные права.
  ["/api/warehouse/receipts/correct", { permission: "warehouse.approve" }],
  ["/api/warehouse/tasks/[id]/cancel", { permission: "warehouse.approve" }],
  ["/api/warehouse/writeoffs", { read: "warehouse.view", write: "warehouse.stock.adjust" }],
  ["/api/warehouse/docs/[id]/reverse", { permission: "warehouse.stock.adjust" }],
  // Справочник товаров ведёт закупщик, а не фулфилмент (§11, «Ограничения»).
  ["/api/warehouse/products", { read: "warehouse.view", write: "purchase.manage" }],
  ["/api/warehouse/products/", { read: "warehouse.view", write: "purchase.manage" }],
  ["/api/warehouse/variants", { read: "warehouse.view", write: "purchase.manage" }],
  ["/api/warehouse/variants/import", { permission: "purchase.manage" }],
  ["/api/warehouse/warehouses", { read: "warehouse.view", write: "settings.manage" }],
  ["/api/warehouse/warehouses/", { read: "warehouse.view", write: "settings.manage" }],
  ["/api/warehouse/kiz/nightly", { open: "cron" }],
  ["/api/warehouse/kiz/collect", { open: "cron" }],

  // ── Закупки ──
  ["/api/purchase-orders", { permission: "purchase.manage" }],
  ["/api/purchase-orders/", { permission: "purchase.manage" }],
  ["/api/moysklad", { permission: "purchase.manage" }],

  // ── Поставки ──
  ["/api/supplies", { read: READ_ANALYTICS, write: "supply.manage" }],
  ["/api/supplies/", { read: READ_ANALYTICS, write: "supply.manage" }],
  // Приёмка — работа склада, а не планирование поставки: право на неё
  // складское, иначе оператор фулфилмента не смог бы принять товар.
  ["/api/supplies/receipts", { read: READ_ANALYTICS, write: "warehouse.task.execute" }],
  ["/api/supplies/receipts/", { read: READ_ANALYTICS, write: "warehouse.task.execute" }],
  ["/api/planning/", { read: READ_ANALYTICS, write: "supply.manage" }],
  ["/api/sales-plan", { read: READ_ANALYTICS, write: "supply.manage" }],

  // ── Реклама ──
  ["/api/adverts/", { read: READ_ANALYTICS, write: "ads.manage" }],
  ["/api/adverts/token", { permission: "settings.manage" }],

  // ── Товар, контент, тесты обложек ──
  ["/api/pim", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/pim/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/content/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/seo/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/sklejki", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/cover-test", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/ugc/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/post/", { permission: "catalog.edit" }],
  ["/api/reviews", { read: READ_ANALYTICS, write: "reviews.manage" }],
  ["/api/ctrtest/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/ctrtest/rotate", { open: "cron" }],
  ["/api/ctrtest/token", { permission: "settings.manage" }],
  ["/api/design", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/design/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  ["/api/design/price-update", { permission: "price.edit" }],

  // ── Творческая лаборатория: генерация фото и видео для карточек ──
  ["/api/lab/", { read: READ_ANALYTICS, write: "catalog.edit" }],
  // Тонкие прокси медиа: их публичный адрес уходит внешним рендерам, и они
  // держат собственную подпись (lib/auth/proxyAuth.ts).
  ["/api/lab/img-proxy", { open: "self-guarded" }],
  ["/api/lab/media-proxy", { open: "self-guarded" }],
  ["/api/lab/yandex-img", { open: "self-guarded" }],
  ["/api/lab/drive-img/", { open: "self-guarded" }],
  ["/api/lab/model-avatar/", { open: "self-guarded" }],
  ["/api/lab/model-photos/", { open: "self-guarded" }],
  ["/api/lab/product-image", { open: "self-guarded" }],

  // ── Цены ──
  ["/api/repricer/", { read: READ_ANALYTICS, write: "price.edit" }],
  ["/api/repricer/run/cron", { open: "cron" }],
  ["/api/unit/price-solver", { read: READ_ANALYTICS, write: "price.edit" }],

  // ── Аналитика и витрины ──
  ["/api/unit/", REFRESH],
  ["/api/abc", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/agent", REFRESH],
  ["/api/agent/", REFRESH],
  ["/api/market/", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/operational-health", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/rnp/", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/shops", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/signals", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/sku-order", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/trends", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/shelf/", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  // Сборщик «Полок» на машине владельца ходит по собственному секрету.
  ["/api/shelf/ingest", { open: "self-guarded" }],
  ["/api/shelf/watchlist", { open: "self-guarded" }],

  // ── Кабинеты маркетплейсов ──
  ["/api/wb/", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  // Удержания и комиссии нужны внешнему менеджеру для юнит-экономики
  // (ТЗ §12.1), и сегодня они ему открыты. Право отчётов маркетплейсов
  // закрыло бы этот экран напрасно: это не работа с самим отчётом, а
  // чтение уже посчитанных расходов.
  ["/api/wb/losses", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/wb/backfill", { permission: "mp_reports.sync" }],
  // Клиент набирает свою команду сам — это его организация, не наша. Но
  // «посмотреть, кто в команде» и «завести человека» — разные действия:
  // первое нужно каждому сотруднику клиента, второе только главному.
  ["/api/wb/team", { read: READ_ANALYTICS, write: "users.manage" }],
  ["/api/ozon/", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
  ["/api/ozon/losses", { read: READ_ANALYTICS, write: READ_ANALYTICS }],
];

/** Правила от длинного пути к короткому: частный случай побеждает общий. */
const SORTED = [...RULES].sort((left, right) => right[0].length - left[0].length);

export const API_RULES = RULES;

/**
 * Что требуется для запроса. `null` — роут не описан, и это ошибка карты, а
 * не разрешение: неизвестный эндпоинт должен закрываться, а не открываться.
 */
export function apiAccessFor(pathname: string): ApiAccess | null {
  for (const [path, access] of SORTED) {
    if (path.endsWith("/") ? pathname.startsWith(path) : pathname === path) return access;
  }
  return null;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Право, нужное для конкретного запроса.
 *
 * Возвращает `{ open }` для роутов со своим сторожем, `{ permission }` для
 * остальных и `null` для неописанных.
 */
export function apiPermissionFor(
  pathname: string,
  method: string,
): { permission: Permission } | { open: OpenReason } | null {
  const access = apiAccessFor(pathname);
  if (!access) return null;
  if ("open" in access) return { open: access.open };
  if ("permission" in access) return { permission: access.permission };
  return { permission: WRITE_METHODS.has(method.toUpperCase()) ? access.write : access.read };
}
