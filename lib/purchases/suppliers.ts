import { PURCHASE_CURRENCIES, type PurchaseCurrency } from "./order";

export interface SupplierInput {
  id?: string;
  name: string;
  country: string;
  taxId: string;
  currency: PurchaseCurrency;
  productionDays: number;
  minOrderQty: number | null;
  contactName: string;
  contactPhone: string;
  note: string;
  isActive: boolean;
}

export interface SupplierView extends SupplierInput {
  id: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type ValidationResult =
  | { ok: true; value: SupplierInput }
  | { ok: false; error: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/**
 * Поставщика ведёт закупщик, и ошибка здесь стоит дорого: неверный срок
 * производства искажает план дозаказа, а опечатка в названии заводит второго
 * поставщика вместо одного (уникальность по имени ловит только точное
 * совпадение — 40 «Guangzhou Feiyang» и «Guangzhou Feiyang Ltd» останутся
 * двумя строками, это ответственность человека, не поля).
 */
export function normalizeSupplierPayload(raw: unknown, forced?: { id?: string }): ValidationResult {
  const source = record(raw);
  const id = text(forced?.id ?? source.id, 60) || undefined;
  const name = text(source.name, 300);
  // Валюта и срок производства не обязательны при заведении: их часто не
  // знают в момент, когда просто хотят выбрать поставщика в заказе, и
  // требовать их тут же значило бы заставить угадывать число. CNY и 0 дней —
  // те же умолчания, что у нового заказа фабрике (order.ts).
  const currencyRaw = text(source.currency, 3);
  const currency = (currencyRaw || "CNY") as PurchaseCurrency;
  const productionDaysRaw = source.productionDays;
  const productionDays = productionDaysRaw === undefined || productionDaysRaw === null || productionDaysRaw === ""
    ? 0
    : number(productionDaysRaw);
  const minOrderQtyRaw = source.minOrderQty;
  const isActive = typeof source.isActive === "boolean" ? source.isActive : true;

  if (!name) return { ok: false, error: "Укажите название поставщика" };
  if (!PURCHASE_CURRENCIES.includes(currency)) return { ok: false, error: "Поддерживаются валюты CNY, RUB и USD" };
  if (!Number.isInteger(productionDays) || productionDays < 0 || productionDays > 365) {
    return { ok: false, error: "Срок производства должен быть от 0 до 365 дней" };
  }

  let minOrderQty: number | null = null;
  if (minOrderQtyRaw !== null && minOrderQtyRaw !== undefined && minOrderQtyRaw !== "") {
    const parsed = number(minOrderQtyRaw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000_000) {
      return { ok: false, error: "Минимальная партия должна быть целым числом от 0" };
    }
    minOrderQty = parsed;
  }

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      name,
      country: text(source.country, 200),
      taxId: text(source.taxId, 100),
      currency,
      productionDays,
      minOrderQty,
      contactName: text(source.contactName, 200),
      contactPhone: text(source.contactPhone, 100),
      note: text(source.note, 5_000),
      isActive,
    },
  };
}
