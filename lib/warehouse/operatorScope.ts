import type { Role } from "@/lib/auth/session";
import { isExternalRole } from "@/lib/auth/permissions";

/** Оператор фулфилмента — сотрудник чужой компании. По ТЗ команды ему открыты
 *  действия руками (принять, пересчитать, отметить брак, отгрузить по заданию),
 *  а всё, что меняет план или историю (задание, коррекция, сторно, справочник),
 *  остаётся администратору и менеджеру. Проверяется и в интерфейсе, и в
 *  каждом роуте: спрятанная кнопка — не защита. */
export function isWarehouseOperator(role: Role | string | null | undefined): boolean {
  return role === "warehouse";
}

/** Кто ставит задания, правит приход и отменяет документы.
 *
 *  Внешний селлер — ДА: в своём юрлице он хозяин товара, а не наёмный
 *  исполнитель, и вести склад без этих действий невозможно. Границу держит не
 *  роль, а юрлицо: resolveEntity отдаёт ему только его собственное, и любой
 *  документ, товар или партия чужого юрлица отсекаются до записи. */
export function canManageStock(role: Role | string | null | undefined): boolean {
  return Boolean(role) && role !== "warehouse";
}

/** Внешняя компания: ей видна только своя часть склада, а общие справочники и
 *  чужие кабинеты закрыты. Отдельно от canManageStock, потому что это не про
 *  «сколько прав», а про «чьи данные».
 *
 *  Обе внешние роли (рядовой seller И главный пользователь клиента
 *  seller_owner) — раньше здесь стояло буквальное `role === "seller"`, и
 *  seller_owner проходил как внутренний: `ownEntities` во всех восьми роутах
 *  склада (products, variants, warehouses, balances, stock), которые зовут
 *  эту функцию, оставался `null` — «без ограничения» — и главный пользователь
 *  клиента видел склад ЛЮБОГО юрлица, а не только своего. */
export function isExternalSeller(role: Role | string | null | undefined): boolean {
  return isExternalRole(role);
}

export const OPERATOR_FORBIDDEN = "Это действие доступно администратору и менеджеру; оператору склада — нет";
