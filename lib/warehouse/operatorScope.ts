import type { Role } from "@/lib/auth/session";

/** Оператор фулфилмента — сотрудник чужой компании. По ТЗ команды ему открыты
 *  действия руками (принять, пересчитать, отметить брак, отгрузить по заданию),
 *  а всё, что меняет план или историю (задание, коррекция, сторно, справочник),
 *  остаётся администратору и менеджеру. Проверяется и в интерфейсе, и в
 *  каждом роуте: спрятанная кнопка — не защита. */
export function isWarehouseOperator(role: Role | string | null | undefined): boolean {
  return role === "warehouse";
}

/** Кто ставит задания, правит приход и отменяет документы. Внешний селлер в
 *  модуль склада не ходит вовсе, поэтому ему тоже «нет». */
export function canManageStock(role: Role | string | null | undefined): boolean {
  return Boolean(role) && role !== "warehouse" && role !== "seller";
}

export const OPERATOR_FORBIDDEN = "Это действие доступно администратору и менеджеру; оператору склада — нет";
