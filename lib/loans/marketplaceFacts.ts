import type { ScheduleRowKind } from "./scheduleRows";

export type WbLoanFactKind = ScheduleRowKind | "unknown";

export interface WbLoanPaymentFact {
  source: string;
  cabinetId: string;
  rrdId: string;
  date: string;
  amountRub: number;
  contractNumber: string | null;
  kind: WbLoanFactKind;
  reason: string;
}

const dateOnly = (value: unknown) => String(value ?? "").slice(0, 10);

/** Читает именно удержания кредита из сохранённого финотчёта WB. */
export function wbLoanFactFromRow(row: Record<string, unknown>): WbLoanPaymentFact | null {
  const reason = String(row.bonus_type_name ?? "").trim();
  const normalized = reason.toLowerCase();
  if (!normalized.startsWith("перевод на баланс заёмщика для ")) return null;
  const amountRub = Math.abs(Number(row.deduction ?? 0));
  const cabinetId = String(row.cabinet_id ?? "").trim();
  const rrdId = String(row.rrd_id ?? "").trim();
  const date = dateOnly(row.rr_dt);
  if (!cabinetId || !rrdId || !date || !Number.isFinite(amountRub) || amountRub <= 0) return null;
  const contractNumber = normalized.match(/(?:кредит[ауе]?|займ[ауе]?)\s*(?:№\s*)?(\d{6,})/i)?.[1] ?? null;
  const kind: WbLoanFactKind = normalized.includes("основного долга")
    ? "principal"
    : normalized.includes("процент")
      ? "interest"
      : normalized.includes("пени")
        ? "penalty"
        : normalized.includes("комисси")
          ? "fee"
          : "unknown";
  return { source: `wb:${cabinetId}:${rrdId}`, cabinetId, rrdId, date, amountRub, contractNumber, kind, reason };
}

export function contractNumberFromComment(comment: string | null | undefined): string | null {
  return comment?.match(/\[contract-number:([^\]]+)\]/)?.[1]?.trim() || null;
}
