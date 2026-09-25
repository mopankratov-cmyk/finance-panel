import type { Payment } from "@/lib/types";
import { chainIdForPayment, chainMetadata, type PaymentChainSummary } from "./paymentChains";
import { INTERCOMPANY_LOAN_CATEGORIES, TECHNICAL_SECTION, sectionForCategory } from "./categories";

export interface PaymentOperationGroup {
  key: string;
  source: Payment;
  chainId?: string;
  parts: Payment[];
  remainder?: number;
  bankTransferId?: string;
  linkedTransfers?: Payment[];
}

export function bankTransferId(comment: string | undefined | null) {
  return comment?.match(/\[dds-bank-transfer:([a-f0-9-]{36})\]/i)?.[1] ?? null;
}

/** Filters select an operation; opening it shows every active part, across dates. */
export function groupPaymentOperations(visible: Payment[], all: Payment[], summaries: PaymentChainSummary[] = []): PaymentOperationGroup[] {
  const result: PaymentOperationGroup[] = [];
  const seen = new Set<string>();
  const activeByChain = new Map<string, Payment[]>();
  const summariesById = new Map(summaries.map(summary => [summary.id, summary]));
  const bankTransfers = new Map<string, Payment[]>();
  for (const payment of all) {
    if (payment.status !== "done") continue;
    const transferId = bankTransferId(payment.comment);
    if (transferId) bankTransfers.set(transferId, [...(bankTransfers.get(transferId) ?? []), payment]);
    const id = chainIdForPayment(payment);
    if (!id) continue;
    const entries = activeByChain.get(id) ?? [];
    entries.push(payment);
    activeByChain.set(id, entries);
  }
  for (const p of visible) {
    const chainId = chainIdForPayment(p);
    const meta = chainMetadata(p.comment);
    const summary = chainId ? summariesById.get(chainId) : undefined;
    const transferId = bankTransferId(p.comment);
    const amount = meta?.amount ?? summary?.amount;
    // Обычный подтверждённый платёж тоже имеет importSource bank-review:<id>.
    // Это ссылка на банковский оригинал, а не признак разбиения. Старую
    // операцию считаем разбитой только когда из неё действительно создано
    // несколько строк; новые цепочки имеют явную служебную метку в comment.
    const isSplit = Boolean(meta) || (summary?.count ?? 0) > 1;
    if (!chainId || !isSplit || amount === null || amount === undefined) {
      result.push({
        key: p.id,
        source: p,
        parts: [],
        bankTransferId: transferId ?? undefined,
        linkedTransfers: transferId
          ? (bankTransfers.get(transferId) ?? []).sort((a,b)=>a.amount-b.amount||a.id.localeCompare(b.id))
          : undefined,
      });
      continue;
    }
    if (seen.has(chainId)) continue;
    seen.add(chainId);
    const entries = (activeByChain.get(chainId) ?? []).filter(entry => !meta || chainMetadata(entry.comment)?.revision === meta.revision);
    const throughCash = entries.some(entry => chainMetadata(entry.comment)?.role === "cash-in");
    const funding = entries.find(entry => chainMetadata(entry.comment)?.role === "source") ?? p;
    const parts = entries.filter(entry => {
      const role = chainMetadata(entry.comment)?.role;
      if (role) return role === "spending" || (!throughCash && role === "source" && entry.amount < 0);
      return entry.amount < 0 && sectionForCategory(entry.category) !== TECHNICAL_SECTION && entry.category !== INTERCOMPANY_LOAN_CATEGORIES.issued;
    }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const allocated = parts.reduce((sum, entry) => sum + Math.round(Math.abs(entry.amount) * 100), 0);
    result.push({ key: chainId, chainId, parts, remainder: (Math.round(amount * 100) - allocated) / 100, source: {
      ...funding, id: p.id, amount: -amount, date: meta?.date ?? summary!.date,
      name: meta?.label ?? summary!.label, category: `Разбито на ${parts.length} частей`, counterparty: "",
      accountId: summary?.sourceAccountId ?? funding.accountId, companyId: summary?.sourceCompanyId ?? funding.companyId,
    } });
  }
  return result;
}
