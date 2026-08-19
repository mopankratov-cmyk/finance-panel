export interface WbFinanceReport {
  reportId: string;
  periodFrom: string | null;
  periodTo: string | null;
  forPaySum: number | null;
  bankPaymentSum: number | null;
  paymentSchedule: string | null;
}

const ISO_DATE = /(?:^|\D)(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?:$|\D)/;

export function strictWbPaymentDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(ISO_DATE)?.[1];
  if (!match) return null;
  const parsed = new Date(`${match}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match ? match : null;
}

export function optionalMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

const text = (value: unknown) => value === null || value === undefined ? "" : String(value).trim();

export function normalizeWbFinanceReports(payload: unknown): WbFinanceReport[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.values(payload as Record<string, unknown>).find(Array.isArray) ?? []
      : [];
  return (source as unknown[]).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const reportId = text(row.reportId ?? row.report_id ?? row.realizationreport_id);
    if (!reportId) return [];
    return [{
      reportId,
      periodFrom: strictWbPaymentDate(row.dateFrom ?? row.date_from),
      periodTo: strictWbPaymentDate(row.dateTo ?? row.date_to),
      forPaySum: optionalMoney(row.forPaySum ?? row.for_pay_sum),
      bankPaymentSum: optionalMoney(row.bankPaymentSum ?? row.bank_payment_sum),
      paymentSchedule: text(row.paymentSchedule ?? row.payment_schedule) || null,
    }];
  });
}
