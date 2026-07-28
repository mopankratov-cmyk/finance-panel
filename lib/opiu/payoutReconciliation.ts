export type PayoutState = "accrual" | "report_confirmed" | "bank_received";

export interface PayoutReport {
  marketplace: "wb" | "ozon";
  cabinetId: string;
  companyId: string;
  reportId: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  estimatedReceiptDate: string;
  state: "report_confirmed";
}

export interface BankReceipt {
  id: string;
  companyId: string;
  amount: number;
  status: "planned" | "done" | "cancelled";
  comment?: string;
}

export interface ReconciliationResult {
  receivedByReport: Map<string, number>;
  unresolved: Array<{ bankReceiptId: string; reason: "ambiguous" | "partial" | "unlinked" | "over_allocation"; amount?: number }>;
}

const safe = (value: string) => value.replace(/[\[\]:]/g, "_");

export function payoutReportKey(report: Pick<PayoutReport, "marketplace" | "cabinetId" | "companyId" | "reportId" | "periodFrom" | "periodTo">) {
  return [report.marketplace, report.cabinetId, report.companyId, report.reportId, report.periodFrom, report.periodTo].map(safe).join(":");
}

export function payoutLinkMarker(report: PayoutReport, amount = report.amount) {
  return `[payout-link:${payoutReportKey(report)}:${Math.max(0, amount)}]`;
}

export function reconcileBankReceipts(reports: PayoutReport[], receipts: BankReceipt[]): ReconciliationResult {
  const byKey = new Map(reports.map((report) => [payoutReportKey(report), report]));
  const receivedByReport = new Map<string, number>();
  const unresolved: ReconciliationResult["unresolved"] = [];
  const seenReceiptIds = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.status !== "done" || receipt.amount <= 0) continue;
    if (seenReceiptIds.has(receipt.id)) continue;
    seenReceiptIds.add(receipt.id);
    const links = [...(receipt.comment ?? "").matchAll(/\[payout-link:([^\]]+):([\d.]+)\]/g)];
    if (!links.length) {
      const candidates = reports.filter((report) => report.companyId === receipt.companyId && Math.abs(report.amount - receipt.amount) < 0.01);
      unresolved.push({ bankReceiptId: receipt.id, reason: candidates.length > 1 ? "ambiguous" : "unlinked", amount: receipt.amount });
      continue;
    }
    const requestedTotal = links.reduce((sum, link) => sum + Number(link[2] || 0), 0);
    if (!Number.isFinite(requestedTotal) || requestedTotal > receipt.amount + 0.01) {
      unresolved.push({ bankReceiptId: receipt.id, reason: "over_allocation", amount: requestedTotal - receipt.amount });
      continue;
    }
    let allocated = 0;
    let overAllocated = 0;
    for (const link of links) {
      const report = byKey.get(link[1]);
      const amount = Number(link[2]);
      if (!report || report.companyId !== receipt.companyId || !Number.isFinite(amount) || amount <= 0) continue;
      const reportReceived = receivedByReport.get(link[1]) ?? 0;
      const reportRemaining = Math.max(0, report.amount - reportReceived);
      const accepted = Math.min(amount, receipt.amount - allocated, reportRemaining);
      if (accepted <= 0) {
        overAllocated += amount;
        continue;
      }
      receivedByReport.set(link[1], reportReceived + accepted);
      allocated += accepted;
      overAllocated += Math.max(0, amount - accepted);
    }
    if (overAllocated > 0.01) unresolved.push({ bankReceiptId: receipt.id, reason: "over_allocation", amount: overAllocated });
    else if (allocated + 0.01 < receipt.amount) unresolved.push({ bankReceiptId: receipt.id, reason: "partial", amount: receipt.amount - allocated });
  }
  return { receivedByReport, unresolved };
}

export function upsertReports(current: PayoutReport[], incoming: PayoutReport[]) {
  const byKey = new Map(current.map((report) => [payoutReportKey(report), report]));
  for (const report of incoming) byKey.set(payoutReportKey(report), report);
  return [...byKey.values()];
}

export function canWriteForecastToCalendar(planSource: string, approvedByFinance: boolean) {
  return planSource === "approved_sales_plan" && approvedByFinance;
}
