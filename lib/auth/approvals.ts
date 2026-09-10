import { isExternalRole, type Role } from "./permissions";

/**
 * Согласования и лимиты: «можно» и «на сколько можно» — разные вопросы.
 *
 * Право отвечает, вправе ли человек вообще совершить действие. Но решения
 * владельца по ТЗ говорят не только о праве: закупщик подтверждает
 * расхождение сам, пока оно не дороже тридцати тысяч и не больше пяти
 * процентов поставки; финансист заводит платёж, но исходящий уходит на
 * подпись финдиректора независимо от суммы. Смешивать это с матрицей прав
 * нельзя: право у роли одно, а порог меняется настройкой и живёт отдельно.
 *
 * Модуль чистый — ни базы, ни сессии. Значения ниже владелец назвал как
 * «по умолчанию», и они обязаны быть настраиваемыми: функции принимают
 * лимиты параметром, а константа лишь задаёт стартовые числа.
 */

/** Пороги, за которыми закупщику нужна чужая подпись. */
export interface WarehouseLimits {
  /** Стоимость расхождения при приёмке, ₽ по себестоимости. */
  discrepancyRub: number;
  /** Доля расхождения от количества товара в поставке, 0–1. */
  discrepancyShare: number;
  /** Списание по одному документу, ₽. */
  writeOffPerDocRub: number;
  /** Списание суммарно за календарный месяц, ₽. */
  writeOffPerMonthRub: number;
}

/** Значения, названные владельцем 09.09.2026. Меняются настройкой. */
export const DEFAULT_WAREHOUSE_LIMITS: WarehouseLimits = {
  discrepancyRub: 30_000,
  discrepancyShare: 0.05,
  writeOffPerDocRub: 10_000,
  writeOffPerMonthRub: 30_000,
};

export type ApprovalVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

const ok: ApprovalVerdict = { allowed: true };
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

/**
 * Может ли закупщик подтвердить расхождение сам.
 *
 * Условия соединены союзом И: превышен хотя бы один порог — нужна подпись
 * финдиректора или руководителя. Доля считается от количества этого товара
 * в поставке, а не от всей поставки: пять процентов от тысячи коробок и
 * пять процентов от одной — разные события, и объединять их нельзя.
 */
export function buyerMayApproveDiscrepancy(
  input: { costRub: number; quantity: number; suppliedQuantity: number },
  limits: WarehouseLimits = DEFAULT_WAREHOUSE_LIMITS,
): ApprovalVerdict {
  if (!(input.costRub <= limits.discrepancyRub)) {
    return { allowed: false, reason: `расхождение на ${money(input.costRub)} дороже лимита ${money(limits.discrepancyRub)}` };
  }
  // Поставка без количества — не «ноль процентов», а неизвестная доля.
  // Пропустить её значило бы обойти второй порог пустым знаменателем.
  if (!(input.suppliedQuantity > 0)) {
    return { allowed: false, reason: "неизвестно количество товара в поставке — доля расхождения не считается" };
  }
  const share = input.quantity / input.suppliedQuantity;
  if (!(share <= limits.discrepancyShare)) {
    return { allowed: false, reason: `расхождение ${(share * 100).toFixed(1)}% больше лимита ${(limits.discrepancyShare * 100).toFixed(0)}% от поставки` };
  }
  return ok;
}

/**
 * Может ли закупщик списать сам.
 *
 * Второй порог — накопительный за календарный месяц, поэтому в расчёт
 * входит и текущий документ: иначе десять списаний по девять тысяч прошли
 * бы мимо месячного лимита, каждое поодиночке законное.
 */
export function buyerMayWriteOff(
  input: { docRub: number; monthToDateRub: number },
  limits: WarehouseLimits = DEFAULT_WAREHOUSE_LIMITS,
): ApprovalVerdict {
  if (!(input.docRub <= limits.writeOffPerDocRub)) {
    return { allowed: false, reason: `списание на ${money(input.docRub)} больше лимита ${money(limits.writeOffPerDocRub)} на документ` };
  }
  const total = input.monthToDateRub + input.docRub;
  if (!(total <= limits.writeOffPerMonthRub)) {
    return { allowed: false, reason: `за месяц выйдет ${money(total)} при лимите ${money(limits.writeOffPerMonthRub)}` };
  }
  return ok;
}

/**
 * Перемещение: внутри юрлица закупщик подтверждает без денежного порога,
 * между юрлицами — не подтверждает вовсе. Это не про сумму, а про то, что
 * товар меняет владельца, и такое решение принимает руководитель.
 */
export function buyerMayApproveTransfer(input: { fromEntityId: string; toEntityId: string }): ApprovalVerdict {
  if (input.fromEntityId !== input.toEntityId) {
    return { allowed: false, reason: "перемещение между юрлицами согласует руководитель или финансовый директор" };
  }
  return ok;
}

/** Что делают с финансовой операцией. */
export type FinanceAction =
  | "create"
  | "edit"
  /** Правка операции, которую уже утвердили. */
  | "edit-approved"
  | "cancel"
  /** Исправление в закрытом периоде. */
  | "edit-closed-period"
  | "classify"
  | "reconcile"
  | "report-sync";

export interface FinanceOperationContext {
  action: FinanceAction;
  /** Исходящий платёж — тот, которым компания расстаётся с деньгами. */
  outgoing?: boolean;
}

/**
 * Нужна ли подпись финдиректора.
 *
 * Владелец очертил границу прямо: любой ИСХОДЯЩИЙ платёж — независимо от
 * суммы, будь то поставщик, сотрудник, налог, кредит или заём. Плюс три
 * действия, которые задним числом меняют уже принятое решение: правка
 * утверждённого платежа, отмена и исправление закрытого периода.
 *
 * Всё остальное — входящие деньги, загрузка отчётов, пересчёт, сверка и
 * классификация — финансист делает сам. Это ровно та работа, ради которой
 * роль и заведена, и требовать на неё подпись значило бы остановить день.
 */
export function financeNeedsApproval(context: FinanceOperationContext): boolean {
  if (context.action === "edit-approved" || context.action === "cancel" || context.action === "edit-closed-period") return true;
  if (context.action === "create" || context.action === "edit") return context.outgoing === true;
  return false;
}

/**
 * Внешний контур согласований не знает.
 *
 * Клиент распоряжается своим юрлицом сам: ни руководитель, ни финдиректор
 * не утверждают его рекламу, цены, поставки и себестоимость. Порядок
 * согласований — внутреннее устройство нашей компании, и переносить его на
 * чужую значило бы сделать клиента подчинённым.
 */
export function approvalAppliesTo(role: Role | string | null | undefined): boolean {
  return !isExternalRole(role);
}
