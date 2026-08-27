import { OPIU_WB_CABINET_ID } from "@/lib/opiu/constants";
import { syncReportRows, type SyncReportRowsResult } from "@/lib/opiu/syncReportRows";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";

export interface OpiuReportPeriod {
  dateFrom: string;
  dateTo: string;
}

export class OpiuReportCabinetNotFoundError extends Error {
  constructor() {
    super("OPiU WB cabinet was not found");
    this.name = "OpiuReportCabinetNotFoundError";
  }
}

function moscowDateParts(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
  };
}

function isoDate(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function opiuReportMonthPeriod(month: string): OpiuReportPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2024 || year > 2100 || monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    dateFrom: isoDate(year, monthNumber, 1),
    dateTo: isoDate(year, monthNumber, lastDay),
  };
}

/**
 * WB can adjust the previous report period after month close. Refresh the
 * current month together with the previous one so late logistics, storage and
 * corrections are repaired automatically.
 */
export function opiuReportRefreshPeriod(now = new Date()): OpiuReportPeriod {
  const current = moscowDateParts(now);
  const previousMonth = current.month === 1 ? 12 : current.month - 1;
  const previousYear = current.month === 1 ? current.year - 1 : current.year;
  return {
    dateFrom: isoDate(previousYear, previousMonth, 1),
    dateTo: isoDate(current.year, current.month, current.day),
  };
}

export async function syncOpiuReportPeriod(
  period: OpiuReportPeriod,
  cabinetId: string = OPIU_WB_CABINET_ID,
): Promise<SyncReportRowsResult> {
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) throw new OpiuReportCabinetNotFoundError();
  const token = resolveWbToken(cabinet, "statistics");
  return syncReportRows(cabinet.id, token, period.dateFrom, period.dateTo);
}

export async function syncOpiuReportMonth(
  month: string,
): Promise<SyncReportRowsResult> {
  const period = opiuReportMonthPeriod(month);
  if (!period) throw new Error("month must be in YYYY-MM format");
  return syncOpiuReportPeriod(period);
}
