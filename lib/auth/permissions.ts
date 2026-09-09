/**
 * Права — это действия, а не экраны.
 *
 * До сих пор роль в панели была списком префиксов URL: «менеджеру открыт
 * /wb». Такой список отвечает на вопрос «куда пустить», но не отвечает на
 * вопрос «что там можно делать», а ТЗ по ролям состоит почти целиком из
 * второго: менеджер ВИДИТ себестоимость, но не меняет; финансист СОЗДАЁТ
 * операцию, но не утверждает; закупщик подтверждает расхождение, а
 * фулфилмент — только заводит. Путь этого не выражает, поэтому появился
 * отдельный словарь действий.
 *
 * Проверка складывается из трёх осей, и все три обязаны сойтись:
 *   ДЕЙСТВИЕ  — что человек делает (этот файл);
 *   МАРКЕТПЛЕЙС — в чьём контуре (менеджер WB не ходит в Ozon);
 *   ОБЛАСТЬ   — над чьими данными (кабинеты из сессии, юрлицо производно от
 *               кабинета, организация — стена внешнего контура).
 *
 * Файл намеренно чистый: ни базы, ни Next, ни сессии. Матрица прав — это
 * утверждение о том, как устроена компания, и проверяться она должна тестом
 * за миллисекунды, а не прогоном экрана.
 */

/** Действие, которое можно разрешить или запретить. */
export type Permission =
  // ── Финансы компании (ДДС, банк, займы, платёжный календарь, бюджеты) ──
  | "finance.view"
  | "finance.edit"
  /** Утвердить или отменить операцию. Отделено от edit намеренно: финансист
   *  готовит, финдиректор утверждает (ТЗ §15.1). */
  | "finance.approve"
  | "finance.period.close"

  // ── Финансовые отчёты маркетплейсов ──
  | "mp_reports.view"
  /** Загрузка, повторная загрузка, синхронизация, пересчёт, сверка. */
  | "mp_reports.sync"
  /** Классификация операций и исправление ручной классификации. */
  | "mp_reports.classify"

  // ── Аналитика маркетплейсов (продажи, воронка, остатки, маржа) ──
  | "analytics.view"

  // ── Себестоимость ──
  | "cost.view"
  | "cost.edit"

  // ── Товарный контур ──
  | "catalog.edit"
  | "price.edit"
  | "ads.manage"
  | "reviews.manage"
  | "supply.manage"

  // ── Закупки ──
  | "purchase.manage"

  // ── Склад ──
  /** Выполнить назначенное складское задание: принять, пересчитать, собрать. */
  | "warehouse.task.execute"
  /** Завести заявку или черновик акта расхождения — без изменения остатка. */
  | "warehouse.request.create"
  /** Подтвердить чужую заявку или акт расхождения. */
  | "warehouse.approve"
  /** Списать, провести инвентаризацию, изменить учётный остаток. */
  | "warehouse.stock.adjust"

  // ── Кадры и зарплата ──
  | "hr.view"
  | "hr.edit"
  | "payroll.view"
  /** Подготовить ведомость, внести премии и удержания. */
  | "payroll.edit"
  /** Утвердить сумму к выплате. */
  | "payroll.approve"

  // ── Учётные записи ──
  | "users.manage"
  | "users.roles.assign"

  // ── Прочее ──
  | "audit.view"
  | "settings.manage"
  /** Показать секрет маркетплейса в открытом виде. Не выдано никому: ТЗ §2.9
   *  запрещает это для всех, и право существует только чтобы запрет был
   *  выражен явно, а не забыт. */
  | "tokens.reveal";

/**
 * Роли.
 *
 * Внутренний контур — сотрудники компании. Внешний — клиент-селлер и его
 * люди: у них своя организация, свои кабинеты и свой администратор, и
 * смешивать их данные с нашими нельзя ни при каких условиях.
 */
export type Role =
  // Внутренний контур
  | "director"
  | "fin_director"
  | "financier"
  | "hr"
  | "wb_manager"
  | "ozon_manager"
  | "buyer"
  | "warehouse"
  // Внешний контур
  | "seller_owner"
  | "seller";

export const ROLE_LABEL: Record<Role, string> = {
  director: "Руководитель",
  fin_director: "Финансовый директор",
  financier: "Финансист",
  hr: "HR",
  wb_manager: "Менеджер Wildberries",
  ozon_manager: "Менеджер Ozon",
  buyer: "Закупщик",
  warehouse: "Сотрудник фулфилмента",
  seller_owner: "Внешний менеджер (главный)",
  seller: "Внешний менеджер",
};

/** Роли внешнего контура: их данные отделены стеной организации. */
export const EXTERNAL_ROLES: readonly Role[] = ["seller_owner", "seller"];

export function isExternalRole(role: Role | string | null | undefined): boolean {
  return EXTERNAL_ROLES.includes(role as Role);
}

/**
 * Роли, работающие в выданном списке кабинетов.
 *
 * Для них пустой список значит «все кабинеты» только у внутренних ролей —
 * так исторически заводили менеджеров. У внешнего контура пустой список
 * всегда значит «ни одного»: там пустота не может открывать чужое.
 */
export function isCabinetScopedRole(role: Role | string | null | undefined): boolean {
  return role === "wb_manager" || role === "ozon_manager" || isExternalRole(role);
}

/** Маркетплейсы, в контур которых роль вообще допущена. */
export type Marketplace = "wb" | "ozon";

const BOTH: readonly Marketplace[] = ["wb", "ozon"];

export const ROLE_MARKETPLACES: Record<Role, readonly Marketplace[]> = {
  director: BOTH,
  fin_director: BOTH,
  financier: BOTH,
  hr: [],
  wb_manager: ["wb"],
  ozon_manager: ["ozon"],
  buyer: BOTH,
  warehouse: [],
  seller_owner: BOTH,
  seller: BOTH,
};

const ANALYTICS: readonly Permission[] = ["analytics.view"];

/** Товарный контур маркетплейса: то, чем занят менеджер. */
const MERCHANDISING: readonly Permission[] = [
  "catalog.edit",
  "price.edit",
  "ads.manage",
  "reviews.manage",
  "supply.manage",
];

/** Полный доступ к финансовым отчётам маркетплейсов (ТЗ §14). */
const MP_REPORTS_FULL: readonly Permission[] = [
  "mp_reports.view",
  "mp_reports.sync",
  "mp_reports.classify",
];

/**
 * Матрица «роль → что можно».
 *
 * Каждая строка — прямой пересказ раздела ТЗ, и расхождение с ним ловится
 * тестом. Где ТЗ молчит, действует запрет: право не выдаётся, пока его не
 * попросили словами.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // §4. Полный доступ ко всему.
  director: [
    "finance.view", "finance.edit", "finance.approve", "finance.period.close",
    ...MP_REPORTS_FULL, ...ANALYTICS,
    "cost.view", "cost.edit",
    ...MERCHANDISING,
    "purchase.manage",
    "warehouse.task.execute", "warehouse.request.create", "warehouse.approve", "warehouse.stock.adjust",
    "hr.view", "hr.edit", "payroll.view", "payroll.edit", "payroll.approve",
    "users.manage", "users.roles.assign",
    "audit.view", "settings.manage",
  ],

  // §5. Полный финансовый контур и сотрудники — но не товарный контур.
  // Реклама, карточки, контент, отзывы, цены и токены закрыты явно (§5,
  // «Ограничения»); настройки системы ТЗ оставляет одному руководителю (§4).
  fin_director: [
    "finance.view", "finance.edit", "finance.approve", "finance.period.close",
    ...MP_REPORTS_FULL, ...ANALYTICS,
    "cost.view", "cost.edit",
    "hr.view", "hr.edit", "payroll.view", "payroll.edit", "payroll.approve",
    "users.manage", "users.roles.assign",
    "audit.view",
  ],

  // §6. Ежедневная финансовая работа. Утверждение и закрытие периода —
  // не его: их выполняет финдиректор или руководитель (§6.1).
  financier: [
    "finance.view", "finance.edit",
    ...MP_REPORTS_FULL, ...ANALYTICS,
    "cost.view", "cost.edit",
  ],

  // §7. Кадры. Зарплату готовит, но не утверждает; системные права не
  // раздаёт; финансов и аналитики маркетплейсов не видит вовсе.
  hr: [
    "hr.view", "hr.edit",
    "payroll.view", "payroll.edit",
  ],

  // §8. Менеджер WB. Себестоимость видит, но не правит (§13).
  wb_manager: [
    ...ANALYTICS, "cost.view", ...MERCHANDISING,
  ],

  // §9. Менеджер Ozon — те же права в своём контуре.
  ozon_manager: [
    ...ANALYTICS, "cost.view", ...MERCHANDISING,
  ],

  // §10. Закупки, поставщики, себестоимость и приёмка на складе.
  // Подтверждение расхождений — его (§15.4).
  buyer: [
    ...ANALYTICS,
    "cost.view", "cost.edit",
    "purchase.manage", "supply.manage",
    "warehouse.request.create", "warehouse.approve",
  ],

  // §11. Только своя часть склада. Себестоимости, цен, финансов и аналитики
  // не видит; собственное расхождение не утверждает; остаток руками не меняет.
  warehouse: [
    "warehouse.task.execute", "warehouse.request.create",
  ],

  // §12. Внешний менеджер: товарный контур, себестоимость и заявки на склад
  // строго в пределах своего юрлица. Плюс — управление своими сотрудниками:
  // у клиента есть главный пользователь, который раздаёт доступ своей команде.
  seller_owner: [
    ...ANALYTICS,
    "cost.view", "cost.edit",
    ...MERCHANDISING,
    "warehouse.request.create",
    "users.manage",
  ],

  // Сотрудник клиента. Тот же контур, но команду не набирает.
  seller: [
    ...ANALYTICS,
    "cost.view", "cost.edit",
    ...MERCHANDISING,
    "warehouse.request.create",
  ],
};

const ROLE_PERMISSION_SETS = new Map<Role, ReadonlySet<Permission>>(
  (Object.keys(ROLE_PERMISSIONS) as Role[]).map((role) => [role, new Set(ROLE_PERMISSIONS[role])]),
);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_PERMISSIONS;
}

/**
 * Может ли роль выполнить действие.
 *
 * Неизвестная роль не получает ничего. Это единственный безопасный ответ:
 * учётка со сломанным или устаревшим значением роли должна упереться в
 * отказ, а не провалиться в права по умолчанию.
 */
export function roleCan(role: Role | string | null | undefined, permission: Permission): boolean {
  if (!isRole(role)) return false;
  return ROLE_PERMISSION_SETS.get(role)!.has(permission);
}

/**
 * Допущена ли роль в контур маркетплейса.
 *
 * Отдельная ось от прав: «редактировать карточки» у менеджера WB и у
 * менеджера Ozon — одно и то же право, а вот товары разные. Без этой
 * проверки менеджер WB, зная ссылку, открыл бы Ozon с полными правами.
 */
export function roleAllowsMarketplace(
  role: Role | string | null | undefined,
  marketplace: Marketplace,
): boolean {
  if (!isRole(role)) return false;
  return ROLE_MARKETPLACES[role].includes(marketplace);
}

/** Роли, которым разрешено действие — для тестов и экрана прав. */
export function rolesWith(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) => roleCan(role, permission));
}
