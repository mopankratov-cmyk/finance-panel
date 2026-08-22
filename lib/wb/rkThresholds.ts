// Пороги журнала РК. Значения заданы владельцем 22.08.2026:
// CPO — зелёный до 300 ₽, жёлтый до 400 ₽, красный свыше;
// CPL — зелёный до 60 ₽, жёлтый до 80 ₽, красный свыше.
//
// Ноль заказов — это не «дёшево», а «нет результата»: CPO при orders = 0 не
// считается вовсе (null), иначе строка с расходом и без заказов красилась бы
// зелёным. То же для CPL при carts = 0.

export type WbRkTone = "green" | "amber" | "red";

export const WB_RK_CPO_LIMITS = { green: 300, amber: 400 };
export const WB_RK_CPL_LIMITS = { green: 60, amber: 80 };

function tone(value: number | null, limits: { green: number; amber: number }): WbRkTone | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= limits.green) return "green";
  if (value <= limits.amber) return "amber";
  return "red";
}

export const cpoTone = (value: number | null) => tone(value, WB_RK_CPO_LIMITS);
export const cplTone = (value: number | null) => tone(value, WB_RK_CPL_LIMITS);

/** Стоимость заказа. null — заказов не было, делить не на что. */
export function costPerOrder(spent: number | null, orders: number | null): number | null {
  if (!orders || spent == null) return null;
  return spent / orders;
}

/** Стоимость корзины. null — корзин не было. */
export function costPerCart(spent: number | null, carts: number | null): number | null {
  if (!carts || spent == null) return null;
  return spent / carts;
}

export const WB_RK_TONE_CLASS: Record<WbRkTone, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
};
