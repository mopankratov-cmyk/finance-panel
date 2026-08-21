export type BrowserPayoutMarketplace = "wb" | "ozon";
export type BrowserPayoutState = "awaiting_transfer" | "marketplace_sent";

export interface BrowserPayoutSnapshot {
  marketplace: BrowserPayoutMarketplace;
  cabinetId: string;
  companyId: string;
  accountId: string;
  externalId: string;
  reportId: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /**
   * День выплаты, каким его называет кабинет. null — кабинет его не называет:
   * в отчётах реализации WB есть период и день формирования, а дня перечисления
   * нет вовсе. Тогда снимок приносит только точную СУММУ, а день остаётся
   * расчётным — панель показывает это отдельно, а не выдаёт расчёт за факт.
   */
  plannedDate: string | null;
  amount: number;
  state: BrowserPayoutState;
  capturedAt: string;
}

export interface BrowserPayoutStore {
  version: 1;
  snapshots: BrowserPayoutSnapshot[];
}

const ISO_DATE = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const SAFE_ID = /^[^\[\]\r\n]{1,160}$/;

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalDate(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? (validDate(normalized) ? normalized : undefined) : null;
}

export function normalizeBrowserPayoutSnapshot(value: unknown): BrowserPayoutSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const marketplace = row.marketplace;
  const state = row.state;
  const cabinetId = String(row.cabinetId ?? "").trim();
  const companyId = String(row.companyId ?? "").trim();
  const accountId = String(row.accountId ?? "").trim();
  const externalId = String(row.externalId ?? "").trim();
  const reportIdRaw = String(row.reportId ?? "").trim();
  const reportId = reportIdRaw || null;
  const plannedDate = optionalDate(row.plannedDate);
  const periodFrom = optionalDate(row.periodFrom);
  const periodTo = optionalDate(row.periodTo);
  const amount = Number(row.amount);
  const capturedAt = String(row.capturedAt ?? "").trim();
  const capturedDate = new Date(capturedAt);
  if (
    !(marketplace === "wb" || marketplace === "ozon")
    || !(state === "awaiting_transfer" || state === "marketplace_sent")
    || ![cabinetId, companyId, accountId, externalId].every((item) => SAFE_ID.test(item))
    || reportId !== null && !SAFE_ID.test(reportId)
    || plannedDate === undefined
    // Без дня выплаты снимок обязан опираться на период: иначе его не с чем
    // сопоставить в календаре и незачем принимать.
    || !plannedDate && !(periodFrom && periodTo)
    || periodFrom === undefined || periodTo === undefined
    || periodFrom && periodTo && periodFrom > periodTo
    || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > Number.MAX_SAFE_INTEGER
    || !Number.isFinite(capturedDate.getTime())
  ) return null;
  return {
    marketplace,
    cabinetId,
    companyId,
    accountId,
    externalId,
    reportId,
    periodFrom,
    periodTo,
    plannedDate,
    amount: Math.round(amount * 100) / 100,
    state,
    capturedAt: capturedDate.toISOString(),
  };
}

export function browserPayoutKey(row: Pick<BrowserPayoutSnapshot, "marketplace" | "cabinetId" | "externalId">) {
  return `${row.marketplace}:${row.cabinetId}:${row.externalId}`;
}

export function upsertBrowserPayoutSnapshot(store: BrowserPayoutStore, incoming: BrowserPayoutSnapshot): BrowserPayoutStore {
  const key = browserPayoutKey(incoming);
  const snapshots = store.snapshots.filter((row) => browserPayoutKey(row) !== key);
  snapshots.push(incoming);
  const sortKey = (row: BrowserPayoutSnapshot) => row.plannedDate ?? row.periodTo ?? "";
  snapshots.sort((left, right) => sortKey(right).localeCompare(sortKey(left)) || browserPayoutKey(left).localeCompare(browserPayoutKey(right)));
  return { version: 1, snapshots: snapshots.slice(0, 500) };
}

export function normalizeBrowserPayoutStore(value: unknown): BrowserPayoutStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { version: 1, snapshots: [] };
  const rows = Array.isArray((value as { snapshots?: unknown }).snapshots)
    ? (value as { snapshots: unknown[] }).snapshots
    : [];
  const byKey = new Map<string, BrowserPayoutSnapshot>();
  for (const value of rows) {
    const row = normalizeBrowserPayoutSnapshot(value);
    if (row) byKey.set(browserPayoutKey(row), row);
  }
  return { version: 1, snapshots: [...byKey.values()] };
}

export function resolveBrowserPayoutReportId(
  snapshot: Pick<BrowserPayoutSnapshot, "reportId" | "periodFrom" | "periodTo">,
  reports: Array<{ reportId: string; periodFrom: string | null; periodTo: string | null }>,
) {
  if (snapshot.reportId) return snapshot.reportId;
  if (!snapshot.periodFrom || !snapshot.periodTo) return null;
  const matches = reports.filter((report) => report.periodFrom === snapshot.periodFrom && report.periodTo === snapshot.periodTo);
  return matches.length === 1 ? matches[0].reportId : null;
}

/**
 * Снимки кабинета → строки расчётного графика, по ID самой строки.
 *
 * Ловушка, из-за которой снимок Ozon молча не применялся: `resolveBrowserPayoutReportId`
 * отдаёт ГОЛЫЙ reportId, а `id` строки графика Ozon — составной `payoutReportKey`
 * (`marketplace:cabinetId:companyId:reportId`, см. app/api/opiu/ozon-forecast). У WB
 * `id` строки — сам reportId. Поэтому ключ строит вызывающий: `scheduleIdOf`.
 * Отчёта нет в списке — кладём reportId как есть: такой ключ просто не совпадёт
 * ни с одной строкой, и фактическая выплата в календарь не попадёт (это честнее,
 * чем угадывать строку).
 */
export function browserPayoutsByScheduleId<Report extends { reportId: string; periodFrom: string | null; periodTo: string | null }>(
  snapshots: BrowserPayoutSnapshot[],
  reports: Report[],
  scheduleIdOf: (report: Report) => string,
): Map<string, BrowserPayoutSnapshot> {
  const byReportId = new Map(reports.map((report) => [report.reportId, report]));
  const matched = new Map<string, BrowserPayoutSnapshot>();
  for (const snapshot of snapshots) {
    const reportId = resolveBrowserPayoutReportId(snapshot, reports);
    if (!reportId) continue;
    const report = byReportId.get(reportId);
    matched.set(report ? scheduleIdOf(report) : reportId, snapshot);
  }
  return matched;
}
/**
 * К какому месяцу относить снимок. День выплаты знаем — по нему; не знаем —
 * по концу отчётного периода: именно за него кабинет и заплатит.
 */
export function browserPayoutMonthKey(snapshot: Pick<BrowserPayoutSnapshot, "plannedDate" | "periodTo">) {
  return (snapshot.plannedDate ?? snapshot.periodTo ?? "").slice(0, 7);
}
