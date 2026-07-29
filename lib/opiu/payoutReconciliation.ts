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
  unresolved: Array<{
    bankReceiptId: string;
    reason: "ambiguous" | "partial" | "unlinked" | "over_allocation";
    amount?: number;
  }>;
}

const toCents = (amount: number) => Math.max(0, Math.round(amount * 100));
const strictPositiveDecimal = /^\d+(?:\.\d{1,2})?$/;

function parseLinks(comment: string) {
  const candidates = [...comment.matchAll(/\[payout-link:([^\]]+):([^\]]+)\]/g)];
  return candidates.flatMap((match) => {
    const rawAmount = match[2].trim();
    if (!strictPositiveDecimal.test(rawAmount)) return [];
    const amount = Number(rawAmount);
    return Number.isFinite(amount) && amount > 0
      ? [{ key: match[1], amount }]
      : [];
  });
}

export function payoutReportKey(
  report: Pick<PayoutReport, "marketplace" | "cabinetId" | "companyId" | "reportId">,
) {
  return [report.marketplace, report.cabinetId, report.companyId, report.reportId]
    .map(encodeURIComponent)
    .join(":");
}

export function upsertReports(current: PayoutReport[], incoming: PayoutReport[]) {
  const byKey = new Map(current.map((item) => [payoutReportKey(item), item]));
  for (const item of incoming) byKey.set(payoutReportKey(item), item);
  return [...byKey.values()];
}

export function reconcileBankReceipts(
  reports: PayoutReport[],
  receipts: BankReceipt[],
): ReconciliationResult {
  const reportsByKey = new Map(reports.map((item) => [payoutReportKey(item), item]));
  const receivedCents = new Map<string, number>();
  const unresolved: ReconciliationResult["unresolved"] = [];
  const seenReceiptIds = new Set<string>();

  for (const receipt of receipts) {
    if (receipt.status !== "done" || receipt.amount <= 0 || seenReceiptIds.has(receipt.id)) continue;
    seenReceiptIds.add(receipt.id);

    const receiptCents = toCents(receipt.amount);
    const links = parseLinks(receipt.comment ?? "");
    if (links.length === 0) {
      const candidates = reports.filter((item) =>
        item.companyId === receipt.companyId && toCents(item.amount) === receiptCents);
      unresolved.push({
        bankReceiptId: receipt.id,
        reason: candidates.length > 1 ? "ambiguous" : "unlinked",
        amount: receipt.amount,
      });
      continue;
    }

    const requestedCents = links.reduce((sum, link) => sum + toCents(link.amount), 0);
    if (requestedCents > receiptCents) {
      unresolved.push({
        bankReceiptId: receipt.id,
        reason: "over_allocation",
        amount: (requestedCents - receiptCents) / 100,
      });
      continue;
    }

    let allocatedCents = 0;
    let rejectedCents = 0;
    for (const link of links) {
      const key = link.key;
      const item = reportsByKey.get(key);
      const requested = toCents(link.amount);
      if (!item || item.companyId !== receipt.companyId || requested === 0) continue;

      const alreadyReceived = receivedCents.get(key) ?? 0;
      const remaining = Math.max(0, toCents(item.amount) - alreadyReceived);
      const accepted = Math.min(requested, receiptCents - allocatedCents, remaining);
      receivedCents.set(key, alreadyReceived + accepted);
      allocatedCents += accepted;
      rejectedCents += requested - accepted;
    }

    if (rejectedCents > 0) {
      unresolved.push({
        bankReceiptId: receipt.id,
        reason: "over_allocation",
        amount: rejectedCents / 100,
      });
    } else if (allocatedCents < receiptCents) {
      unresolved.push({
        bankReceiptId: receipt.id,
        reason: "partial",
        amount: (receiptCents - allocatedCents) / 100,
      });
    }
  }

  return {
    receivedByReport: new Map(
      [...receivedCents].map(([key, amount]) => [key, amount / 100]),
    ),
    unresolved,
  };
}
