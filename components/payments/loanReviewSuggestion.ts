import type { BankReviewItem } from "./bankReviewStore";
import type { Payment } from "@/lib/types";
import type { BankInstructionSplit } from "./bankInstructionSplits";

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/gi, " ").trim();

export function suggestLoanSplits(item: BankReviewItem, payments: Payment[]): BankInstructionSplit[] | null {
  if (item.amount >= 0 || !/кредит|займ/i.test(`${item.category ?? ""} ${item.purpose}`)) return null;
  const target = Math.abs(item.amount);
  const candidates = payments.filter((payment) => payment.status === "planned"
    && payment.amount < 0
    && /\[loan:[^\]]+:schedule:[^\]]+:(principal|interest|penalty|fine)\]/.test(payment.comment ?? "")
    && Math.abs(Date.parse(payment.date) - Date.parse(item.date)) <= 14 * 86_400_000);
  const groups = new Map<string, Payment[]>();
  for (const payment of candidates) {
    const marker = payment.comment?.match(/\[loan:([^:\]]+):schedule:([^:\]]+):/)?.slice(1).join(":");
    if (marker) groups.set(marker, [...(groups.get(marker) ?? []), payment]);
  }
  const matches = [...groups.values()].filter((rows) => {
    const total = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const words = normalize(rows.map((row) => `${row.name} ${row.counterparty}`).join(" "));
    const itemWords = normalize(`${item.purpose} ${item.counterparty}`);
    const creditorMatches = itemWords.split(" ").some((word) => word.length >= 5 && words.includes(word));
    return Math.abs(total - target) <= Math.max(1, target * 0.005) && creditorMatches;
  });
  if (matches.length !== 1) return null;
  return matches[0].map((payment) => ({
    id: crypto.randomUUID(),
    amount: Math.abs(payment.amount),
    description: payment.name,
    category: /principal/.test(payment.comment ?? "") ? "Погашение тела кредита"
      : /interest/.test(payment.comment ?? "") ? "Проценты по кредитам и займам"
        : /penalty|fine/.test(payment.comment ?? "") ? "Пени и штрафы по кредитам и займам"
          : payment.category,
    companyId: item.companyId,
    excluded: false,
    needsClarification: false,
  }));
}
