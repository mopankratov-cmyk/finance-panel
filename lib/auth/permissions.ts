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
  /** Видеть остатки, движения и документы склада. Отделено от исполнения:
   *  внешний менеджер смотрит свои остатки, но заданий не выполняет, а
   *  фулфилмент выполняет задание, не видя ничего сверх него. */
  | "warehouse.view"
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
  /** Задавать пороги, за которыми нужна чужая подпись. У компании их ставит
   *  руководство, у внешнего клиента — он сам, в своём юрлице. */
  | "limits.manage"
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
    "warehouse.view", "warehouse.task.execute", "warehouse.request.create", "warehouse.approve", "warehouse.stock.adjust",
    "hr.view", "hr.edit", "payroll.view", "payroll.edit", "payroll.approve",
    "users.manage", "users.roles.assign",
    "limits.manage", "audit.view", "settings.manage",
  ],

  // §5. Полный финансовый контур и сотрудники — но не товарный контур.
  // Реклама, карточки, контент, отзывы, цены и токены закрыты явно (§5,
  // «Ограничения»); настройки системы ТЗ оставляет одному руководителю (§4).
  fin_director: [
    "finance.view", "finance.edit", "finance.approve", "finance.period.close",
    ...MP_REPORTS_FULL, ...ANALYTICS,
    "cost.view", "cost.edit",
    // Склад — на просмотр по всем юрлицам, плюс подпись под внутренними
    // списаниями, расхождениями и стоимостными корректировками. Приёмку и
    // комплектацию за складских он не делает: этих прав здесь нет.
    "warehouse.view", "warehouse.approve", "warehouse.stock.adjust",
    "hr.view", "hr.edit", "payroll.view", "payroll.edit", "payroll.approve",
    "users.manage", "users.roles.assign",
    "limits.manage", "audit.view",
  ],

  // §6. Ежедневная финансовая работа. Утверждение и закрытие периода —
  // не его: их выполняет финдиректор или руководитель (§6.1).
  financier: [
    "finance.view", "finance.edit",
    ...MP_REPORTS_FULL, ...ANALYTICS,
    "cost.view", "cost.edit",
    // Корректировку он готовит, подписывает её финдиректор — поэтому заявка
    // есть, а подтверждения нет.
    "warehouse.view", "warehouse.request.create",
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
    // Списание закупщику разрешено, но не любое: пороги по документу и по
    // месяцу считает lib/auth/approvals.ts. Право отвечает «вправе ли», лимит
    // — «на сколько», и это разные вопросы.
    "warehouse.view", "warehouse.request.create", "warehouse.approve", "warehouse.stock.adjust",
  ],

  // §11. Только своя часть склада. Себестоимости, цен, финансов и аналитики
  // не видит; собственное расхождение не утверждает; остаток руками не меняет.
  warehouse: [
    "warehouse.view", "warehouse.task.execute", "warehouse.request.create",
  ],

  // §12. Внешний менеджер: товарный контур, себестоимость и заявки на склад
  // строго в пределах своего юрлица. Плюс — управление своими сотрудниками:
  // у клиента есть главный пользователь, который раздаёт доступ своей команде.
  seller_owner: [
    ...ANALYTICS,
    "cost.view", "cost.edit",
    ...MERCHANDISING,
    "warehouse.view", "warehouse.request.create",
    "users.manage", "limits.manage",
  ],

  // Сотрудник клиента. Тот же контур, но команду не набирает.
  seller: [
    ...ANALYTICS,
    "cost.view", "cost.edit",
    ...MERCHANDISING,
    "warehouse.view", "warehouse.request.create",
    "limits.manage",
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

/**
 * Сотрудник может держать несколько ролей сразу.
 *
 * Решение владельца: человек, ведущий оба маркетплейса, получает обе роли
 * менеджера, а не третью «менеджер МП». Так набор прав остаётся суммой
 * понятных ролей, и не приходится заводить роль на каждое сочетание —
 * иначе их станет больше, чем людей.
 *
 * Права складываются: достаточно, чтобы действие разрешала ХОТЯ БЫ одна
 * роль. Запрет из другой роли не отнимает уже выданного — иначе вторая
 * роль отбирала бы доступ вместо того, чтобы добавлять, и выдача роли
 * оборачивалась бы поражением в правах.
 */
export function rolesCan(roles: readonly (Role | string)[] | null | undefined, permission: Permission): boolean {
  return (roles ?? []).some((role) => roleCan(role, permission));
}

/** Контур маркетплейса — тоже сумма: две роли менеджера дают оба. */
export function rolesAllowMarketplace(
  roles: readonly (Role | string)[] | null | undefined,
  marketplace: Marketplace,
): boolean {
  return (roles ?? []).some((role) => roleAllowsMarketplace(role, marketplace));
}

/** Первая известная роль: ею подписывают журнал и по ней выбирают стартовый экран. */
export function primaryRole(roles: readonly (Role | string)[] | null | undefined): Role | null {
  return (roles ?? []).find((role): role is Role => isRole(role)) ?? null;
}

/**
 * Роли работают в выданном списке кабинетов, только если ВСЕ они такие.
 *
 * Достаточно одной роли без ограничения по кабинетам — и ограничивать
 * нечего: человек и так видит всё. Проверять «хотя бы одна ограничена»
 * значило бы урезать доступ, который сам же и выдан другой ролью.
 */
export function rolesAreCabinetScoped(roles: readonly (Role | string)[] | null | undefined): boolean {
  const list = roles ?? [];
  return list.length > 0 && list.every((role) => isCabinetScopedRole(role));
}

/** Внешний контур не смешивается с внутренним: одна внешняя роль — весь набор внешний. */
export function rolesAreExternal(roles: readonly (Role | string)[] | null | undefined): boolean {
  return (roles ?? []).some((role) => isExternalRole(role));
}

/** Роли, которым разрешено действие — для тестов и экрана прав. */
export function rolesWith(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) => roleCan(role, permission));
}
