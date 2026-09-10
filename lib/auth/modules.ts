import { isExternalRole, type Role } from "./permissions";

/**
 * Модули для внешнего контура.
 *
 * Решение владельца: у клиента-селлера свой главный пользователь, и он сам
 * раздаёт доступ СВОИМ сотрудникам — по модулям. Клиенту доступны ровно три:
 * Wildberries, Ozon и Склад. Внутренних разделов компании — финансов,
 * зарплаты, закупок, учётных записей — во внешнем контуре нет вовсе, и
 * добавлять их сюда нельзя: это и есть граница между двумя компаниями.
 *
 * Модуль — третья ось поверх роли и области. Роль отвечает, что человек
 * вправе делать; область — над чьими данными; модуль — в каком разделе. Без
 * него у клиента был бы выбор из двух состояний, «всё» и «ничего», а он
 * просил раздавать по частям.
 */
export const EXTERNAL_MODULES = ["wb", "ozon", "warehouse"] as const;
export type ExternalModule = (typeof EXTERNAL_MODULES)[number];

export const MODULE_LABEL: Record<ExternalModule, string> = {
  wb: "Wildberries",
  ozon: "Ozon",
  warehouse: "Склад",
};

export function isExternalModule(value: unknown): value is ExternalModule {
  return typeof value === "string" && (EXTERNAL_MODULES as readonly string[]).includes(value);
}

/**
 * К какому модулю относится путь.
 *
 * `null` — путь не принадлежит ни одному модулю внешнего контура. Для клиента
 * это значит «закрыто»: раздел не его, независимо от прав. Для внутреннего
 * сотрудника — ничего, его модулями не ограничивают.
 */
export function moduleOfPath(pathname: string): ExternalModule | null {
  const path = pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
  if (path === "/wb" || path.startsWith("/wb/")) return "wb";
  if (path === "/ozon" || path.startsWith("/ozon/")) return "ozon";
  if (path === "/warehouse" || path.startsWith("/warehouse/")) return "warehouse";
  if (path === "/supplies" || path.startsWith("/supplies/")) return "warehouse";
  return null;
}

/**
 * Какие модули открыты сотруднику.
 *
 * Пустой список у ВНЕШНЕЙ роли значит «все три», а не «ни одного». Так
 * работают уже заведённые учётки клиентов: у них модулей не проставляли, и
 * прочитать пустоту как запрет значило бы отключить живых людей в день
 * выкладки. Ограничение включается тем, что главный пользователь клиента
 * перечислит модули явно.
 */
export function sessionModules(
  session: { role?: Role | string | null; roles?: (Role | string)[] | null; modules?: string[] | null } | null | undefined,
): readonly ExternalModule[] {
  if (!session) return [];
  const granted = (session.modules ?? []).filter(isExternalModule);
  return granted.length ? granted : EXTERNAL_MODULES;
}

/**
 * Пускать ли сотрудника в раздел.
 *
 * Внутренние роли модулями не ограничены: у них своя карта путей и своя
 * матрица прав, и вводить им третье ограничение ТЗ не просило. Проверка
 * касается только внешнего контура.
 */
export function allowsModulePath(
  session: { role?: Role | string | null; roles?: (Role | string)[] | null; modules?: string[] | null } | null | undefined,
  pathname: string,
): boolean {
  if (!session) return true;
  const roles = session.roles?.length ? session.roles : [session.role];
  const external = roles.some((role) => isExternalRole(role));
  if (!external) return true;
  const target = moduleOfPath(pathname);
  // Путь вне трёх модулей клиенту не принадлежит. Общие вещи вроде списка
  // кабинетов сюда не попадают: они не начинаются с /wb, /ozon, /warehouse
  // и /supplies, и их пускает прежний узкий список ролей.
  if (!target) return true;
  return sessionModules(session).includes(target);
}
