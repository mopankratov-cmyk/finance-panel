import type { Payment } from "@/lib/types";

export interface MarketplaceDestination {
  companyId: string;
  accountId: string;
  source: "previous_publication" | "bank_history";
}

const markerValue = (comment: string | undefined, key: string) =>
  comment?.match(new RegExp(`\\[${key}:([^\\]]+)\\]`))?.[1]?.trim() ?? "";

const isWbReceipt = (payment: Payment) => {
  if (payment.status !== "done" || payment.amount <= 0) return false;
  const text = `${payment.name} ${payment.category} ${payment.counterparty ?? ""} ${payment.comment ?? ""}`.toLowerCase();
  return /wildberries|вайлдберриз|\bwb\b|\bвб\b/.test(text);
};

export function recommendWbDestination(
  cabinetId: string,
  payments: Payment[],
  companyByPayment: Map<string, string | null>,
): MarketplaceDestination | null {
  const published = payments.filter((payment) =>
    markerValue(payment.comment, "forecast-marketplace") === "wb"
    && markerValue(payment.comment, "forecast-cabinet") === cabinetId,
  );
  const publishedPairs = new Map<string, MarketplaceDestination>();
  for (const payment of published) {
    const companyId = markerValue(payment.comment, "forecast-company") || companyByPayment.get(payment.id) || "";
    if (!companyId || !payment.accountId) continue;
    publishedPairs.set(`${companyId}|${payment.accountId}`, { companyId, accountId: payment.accountId, source: "previous_publication" });
  }
  if (publishedPairs.size === 1) return [...publishedPairs.values()][0];
  if (publishedPairs.size > 1) return null;

  const historyPairs = new Map<string, MarketplaceDestination>();
  for (const payment of payments.filter(isWbReceipt)) {
    const companyId = companyByPayment.get(payment.id) || "";
    if (!companyId || !payment.accountId) continue;
    historyPairs.set(`${companyId}|${payment.accountId}`, { companyId, accountId: payment.accountId, source: "bank_history" });
  }
  return historyPairs.size === 1 ? [...historyPairs.values()][0] : null;
}
