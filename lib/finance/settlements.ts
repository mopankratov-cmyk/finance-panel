import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES, isLoanRepaymentCategory } from "./categories";
import { preferredAliasCompany } from "./companyAliases";
import { chainMetadata, isMainGroup, requiresFilippovLoan, type ChainCompany } from "./paymentChains";
import type { Payment } from "@/lib/types";

export type SettlementSide = "we_owe" | "owed_to_us" | "closed";
export type SettlementKind = "counterparty" | "intercompany";

export interface SettlementCompany extends ChainCompany {}

export interface SettlementMovement {
  id: string;
  date: string;
  amount: number;
  label: string;
  category: string;
  companyName: string | null;
}

export interface Settlement {
  id: string;
  kind: SettlementKind;
  counterparty: string;
  side: SettlementSide;
  issuedOrReceived: number;
  returned: number;
  balance: number;
  firstDate: string;
  lastDate: string;
  movements: SettlementMovement[];
}

type Draft = Omit<Settlement, "side" | "balance"> & { net: number };

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();
const money = (value: number) => Math.round(value * 100) / 100;

function isOfficialLoanPayment(payment: Payment): boolean {
  return /\[loan:[^\]]+\]/i.test(payment.comment ?? "");
}

function isLegacyBorrowingCategory(category: string): boolean {
  return ["кредиты и займы", "займы"].includes(normalize(category));
}

function companyForPayment(payment: Payment, companyByPayment: ReadonlyMap<string, string | null>, companies: readonly SettlementCompany[]) {
  const id = payment.companyId ?? companyByPayment.get(payment.id) ?? null;
  return companies.find((company) => company.id === id) ?? null;
}

function intercompanySettlement(payment: Payment, source: SettlementCompany | null, companies: readonly SettlementCompany[]) {
  if (!source || ![INTERCOMPANY_LOAN_CATEGORIES.issued, INTERCOMPANY_LOAN_CATEGORIES.returned].includes(payment.category as typeof INTERCOMPANY_LOAN_CATEGORIES[keyof typeof INTERCOMPANY_LOAN_CATEGORIES])) return null;
  const counterparty = preferredAliasCompany(payment.counterparty, companies);
  if (!counterparty || !requiresFilippovLoan(source, counterparty)) return null;
  const sourceMain = isMainGroup(source);
  const issued = payment.category === INTERCOMPANY_LOAN_CATEGORIES.issued;
  // Положительный net означает «Филиппов должен основной группе».
  const sign = issued ? (sourceMain ? 1 : -1) : (sourceMain ? -1 : 1);
  return { key: "intercompany:filippov-main", title: "ИП Филиппов ↔ Основная группа", sign };
}

/**
 * Витрина беспроцентных взаиморасчётов строится только из фактического ДДС.
 * Плановые строки и договоры, уже ведущиеся в разделе кредитов, исключаются.
 */
export function buildSettlements(
  payments: readonly Payment[],
  companyByPayment: ReadonlyMap<string, string | null>,
  companies: readonly SettlementCompany[],
): Settlement[] {
  const drafts = new Map<string, Draft>();
  const add = (input: { id: string; kind: SettlementKind; title: string; net: number; issuedOrReceived: number; returned: number; payment: Payment; companyName: string | null }) => {
    const current = drafts.get(input.id) ?? {
      id: input.id, kind: input.kind, counterparty: input.title, issuedOrReceived: 0, returned: 0, net: 0,
      firstDate: input.payment.date, lastDate: input.payment.date, movements: [],
    };
    current.issuedOrReceived = money(current.issuedOrReceived + input.issuedOrReceived);
    current.returned = money(current.returned + input.returned);
    current.net = money(current.net + input.net);
    current.firstDate = current.firstDate < input.payment.date ? current.firstDate : input.payment.date;
    current.lastDate = current.lastDate > input.payment.date ? current.lastDate : input.payment.date;
    current.movements.push({
      id: input.payment.id, date: input.payment.date, amount: Math.abs(input.payment.amount), label: input.payment.name || input.payment.counterparty || input.payment.category,
      category: input.payment.category, companyName: input.companyName,
    });
    drafts.set(input.id, current);
  };

  for (const payment of payments) {
    if (payment.status !== "done" || isOfficialLoanPayment(payment)) continue;
    const metadata = chainMetadata(payment.comment);
    // loan-in — зеркальная техническая проводка к loan-out той же цепочки.
    // Учитываем сторону выдачи, иначе один долг появился бы дважды.
    if (metadata?.role === "loan-in") continue;
    const source = companyForPayment(payment, companyByPayment, companies);
    const intercompany = intercompanySettlement(payment, source, companies);
    if (intercompany) {
      const amount = Math.abs(payment.amount);
      const increase = intercompany.sign > 0;
      add({
        id: intercompany.key, kind: "intercompany", title: intercompany.title, payment,
        net: intercompany.sign * amount, issuedOrReceived: increase ? amount : 0, returned: increase ? 0 : amount,
        companyName: source?.name ?? null,
      });
      continue;
    }

    const isReceipt = payment.category === LOAN_CATEGORIES.receipt || isLegacyBorrowingCategory(payment.category);
    const isIssued = payment.category === INTERCOMPANY_LOAN_CATEGORIES.issued;
    const isReturned = payment.category === INTERCOMPANY_LOAN_CATEGORIES.returned;
    const isRepayment = isLoanRepaymentCategory(payment.category);
    if (!isReceipt && !isIssued && !isReturned && !isRepayment) continue;

    const title = payment.counterparty.trim() || "Контрагент не указан";
    const amount = Math.abs(payment.amount);
    // Положительное net — нам должны, отрицательное — должны мы.
    const net = isIssued ? amount : isReturned ? -amount : isReceipt ? -amount : amount;
    const increase = (isIssued || isReceipt);
    add({
      id: `counterparty:${normalize(title) || payment.id}`, kind: "counterparty", title, payment, net,
      issuedOrReceived: increase ? amount : 0, returned: increase ? 0 : amount,
      companyName: source?.name ?? null,
    });
  }

  return [...drafts.values()].map(({ net, ...draft }): Settlement => ({
    ...draft,
    balance: Math.abs(net),
    side: Math.abs(net) < 0.01 ? "closed" : net > 0 ? "owed_to_us" : "we_owe",
    movements: [...draft.movements].sort((left, right) => right.date.localeCompare(left.date)),
  })).sort((left, right) => right.balance - left.balance || right.lastDate.localeCompare(left.lastDate));
}
