import type { Role } from "@/lib/auth/permissions";

/**
 * Модуль «Разработка ассортимента» (ТЗ v3.0 от 01.10.2026,
 * docs/tz/assortment-development-tz-v3.md).
 *
 * Границы ТЗ: в модуле нет цен, валют, себестоимости, маржи, СПП, бюджетов
 * и MOQ — ни в данных, ни в API, ни в интерфейсе. Модуль не вызывает Ozon.
 */

export const ASSORTMENT_DIRECTIONS = ["jackets", "bags"] as const;
export type AssortmentDirection = (typeof ASSORTMENT_DIRECTIONS)[number];

export const DIRECTION_LABEL: Record<AssortmentDirection, string> = {
  jackets: "Куртки",
  bags: "Сумки",
};

export const DIRECTION_BRANDS: Record<AssortmentDirection, string> = {
  jackets: "NORVIA / HEATON",
  bags: "CLÉRIN",
};

export const ASSORTMENT_BASE_PATH = "/assortment-development";
export const ASSORTMENT_LAST_SECTION_KEY = "assortment-development:last-section";

/**
 * Кому открыт модуль — решение владельца 01.10.2026.
 *
 * Право analytics.view есть и у внешних ролей, поэтому карта прав API круг не
 * сужает: его держит каждый роут модуля через requireApiSession(ASSORTMENT_ROLES).
 */
export const ASSORTMENT_ROLES: Role[] = ["director", "buyer", "wb_manager"];

export function parseDirection(value: string | null | undefined): AssortmentDirection | null {
  return ASSORTMENT_DIRECTIONS.find((direction) => direction === value) ?? null;
}

/** Доступ к источнику по факту проверки, а не по исследованию. */
export const ACCESS_STATUSES = [
  "auto_verified",
  "partial",
  "manual_only",
  "untested",
  "unavailable",
  "disabled",
] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  auto_verified: "Автосбор проверен",
  partial: "Частично",
  manual_only: "Только вручную",
  untested: "Доступ не проверен",
  unavailable: "Временно недоступен",
  disabled: "Отключён",
};

export function parseAccessStatus(value: unknown): AccessStatus {
  return ACCESS_STATUSES.find((status) => status === value) ?? "untested";
}
