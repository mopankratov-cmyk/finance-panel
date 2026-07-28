export const UNIT_PERIOD_TIMEZONE = "Europe/Moscow";
export const UNIT_PERIOD_SCHEMA_VERSION = "unit-period-v2";

export interface UnitPeriod {
  from: string;
  to: string;
}

type QueryParams = Pick<URLSearchParams, "get">;

function moscowDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UNIT_PERIOD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function parseIsoDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Дата должна быть в формате YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  const actual = new Date(time);
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) {
    throw new Error("Указана несуществующая календарная дата");
  }
  return time;
}

export function getDefaultUnitPeriod(now = new Date()): UnitPeriod {
  const to = moscowDate(now);
  return { from: `${to.slice(0, 8)}01`, to };
}

export function parseUnitPeriodQuery(searchParams: QueryParams, now = new Date()): UnitPeriod {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from === null && to === null) return getDefaultUnitPeriod(now);
  if (from === null || to === null) throw new Error("Укажите обе даты периода");

  const fromTime = parseIsoDate(from);
  const toTime = parseIsoDate(to);
  if (fromTime > toTime) throw new Error("Начало периода должно быть не позже окончания");
  if ((toTime - fromTime) / 86_400_000 + 1 > 31) throw new Error("Период не может превышать 31 день");
  if (to > moscowDate(now)) throw new Error("Период не может заканчиваться в будущем");
  return { from, to };
}

export function formatUnitPeriod(period: UnitPeriod): string {
  const format = (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
  return `${format(period.from)}–${format(period.to)}`;
}

export function unitPeriodCacheIdentity(input: {
  cabinetId: string | null;
  from: string;
  to: string;
  taxPct: number;
  ff: number;
  targetMargin: number;
}) {
  return { schemaVersion: UNIT_PERIOD_SCHEMA_VERSION, ...input };
}
