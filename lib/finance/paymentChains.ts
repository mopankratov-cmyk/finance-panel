import type { Account, Payment } from "@/lib/types";
import { companyAliasKeys } from "./companyAliases";
import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES, TRANSFER_CATEGORIES } from "./categories";

export interface ChainCompany { id: string; name: string; groupName: string }
export interface ChainAllocation {
  id: string; amount: number; date: string; name: string; category: string;
  companyId: string; accountId: string; targetAccountId?: string; counterparty: string; excluded: boolean;
}
export interface PaymentChainDraft {
  id: string; revision: number; label: string; sourceDate: string; sourceAmount: number;
  sourceAccountId: string; sourceCompanyId: string; cashAccountId: string;
  throughCash: boolean; allocations: ChainAllocation[]; originPaymentIds: string[];
  bankReviewId: string | null;
}
export type ChainRole = "source" | "cash-in" | "loan-out" | "loan-in" | "transfer-in" | "spending";
export interface ChainEntry { payment: Payment; role: ChainRole; allocationId: string | null }
export interface ChainMetadata { id: string; revision: number; amount: number; date: string; label: string; role: ChainRole; allocationId?: string | null }
export interface ChainHistory { revision: number; createdAt: string; reason: string; entries: ChainEntry[] }
export interface PaymentChainDetail { draft: PaymentChainDraft; status: "active" | "cancelled"; migrationAvailable: boolean; history: ChainHistory[] }
const cents = (n: number) => Math.round(n * 100);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
export function isMainGroup(company: ChainCompany | undefined) {
  return Boolean(company && /основн|рио|митриченко|панкратов|кучеренко/.test(norm(company.groupName + " " + company.name)) && !companyAliasKeys(company.name).length);
}
export function requiresKorovkinLoan(source: ChainCompany | undefined, recipient: ChainCompany | undefined) {
  return Boolean(source && recipient && source.id !== recipient.id && isMainGroup(source) && companyAliasKeys(recipient.name).includes("коровкин"));
}
export function allocationTotal(draft: PaymentChainDraft) {
  return draft.allocations.reduce((sum, p) => sum + cents(p.amount), 0) / 100;
}
export function chainRemainder(draft: PaymentChainDraft) { return (cents(draft.sourceAmount) - cents(allocationTotal(draft))) / 100; }
export function encodeChainMetadata(meta: ChainMetadata, comment = "") {
  return comment.replace(/\[dds-chain:[^\]]+\]/g, "").trim() + " [dds-chain:" + encodeURIComponent(JSON.stringify(meta)) + "]";
}
export function chainMetadata(comment: string | undefined | null): ChainMetadata | null {
  const match = comment?.match(/\[dds-chain:([^\]]+)\]/);
  if (!match) return null;
  try {
    const m = JSON.parse(decodeURIComponent(match[1]));
    return typeof m.id === "string" && Number.isInteger(m.revision) && Number.isFinite(m.amount) && typeof m.date === "string" && typeof m.label === "string" && (m.allocationId == null || typeof m.allocationId === "string") && ["source","cash-in","loan-out","loan-in","transfer-in","spending"].includes(m.role) ? m : null;
  } catch { return null; }
}
export function chainIdForPayment(payment: Payment) {
  return chainMetadata(payment.comment)?.id ?? payment.importSource?.match(/^bank-review:([0-9a-f-]{36})(?::|$)/i)?.[1] ?? null;
}
export function validateChain(d: PaymentChainDraft, accounts: Account[], companies: ChainCompany[], categories: readonly string[]) {
  const errors: string[] = [];
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date + "T00:00:00Z").toISOString().slice(0,10) === date;
  const source = companies.find(c => c.id === d.sourceCompanyId);
  const sourceAccount = accounts.find(a => a.id === d.sourceAccountId);
  if (!source || !sourceAccount || sourceAccount.currency !== "RUB") errors.push("Выберите компанию и рублёвый кошелёк источника");
  if (!validDate(d.sourceDate) || !d.label.trim() || !Number.isFinite(d.sourceAmount) || cents(d.sourceAmount) <= 0 || d.sourceAmount !== cents(d.sourceAmount)/100) errors.push("Укажите дату, название и положительную исходную сумму до копеек");
  if (d.allocations.length > 100 || new Set(d.allocations.map(a => a.id)).size !== d.allocations.length) errors.push("Не больше 100 частей с разными идентификаторами");
  const cash = accounts.find(a => a.id === d.cashAccountId);
  if (d.throughCash && (!cash || cash.type !== "cash" || cash.currency !== "RUB")) errors.push("Выберите рублёвый кошелёк наличных основной группы");
  if (d.throughCash && d.sourceAccountId === d.cashAccountId) errors.push("Кошелёк источника и кошелёк пополнения наличных должны отличаться");
  for (const a of d.allocations) {
    if (!Number.isFinite(a.amount) || cents(a.amount) <= 0 || a.amount !== cents(a.amount)/100 || !validDate(a.date) || a.date < d.sourceDate) errors.push("Каждой части нужны сумма до копеек и дата не раньше исходного перевода");
    if (a.excluded) continue;
    const recipient = companies.find(c => c.id === a.companyId);
    const account = accounts.find(acc => acc.id === a.accountId);
    if (!a.name.trim() || !recipient || !account || account.currency !== "RUB" || !categories.includes(a.category)) errors.push("Заполните назначение, компанию, рублёвый кошелёк и статью каждой части");
    if(a.category===TRANSFER_CATEGORIES.outgoing) {
      const target=accounts.find(acc=>acc.id===a.targetAccountId);
      if(!target || target.currency!=="RUB" || target.id===a.accountId)errors.push("У перевода между кошельками выберите другой рублёвый кошелёк поступления");
    }
    if (/Поступление|Получение кредитов|Продажи на МП/.test(a.category)) errors.push("У части расхода выбрана статья поступления");
    if (/зарплат/i.test(a.category) && !a.counterparty.trim()) errors.push("Для зарплаты укажите получателя в каждой части");
    if (requiresKorovkinLoan(source, recipient) && (!d.throughCash || account?.type !== "cash")) errors.push("Расход основной группы на Коровкина оформляется займом через наличные: выберите наличные группы и получателя");
    if (d.throughCash && !requiresKorovkinLoan(source, recipient) && a.accountId !== d.cashAccountId) errors.push("Обычный расход этой суммы должен идти из её наличного кошелька");
    if (!d.throughCash && a.accountId !== d.sourceAccountId) errors.push("Для расхода с другого кошелька включите перевод через наличные");
  }
  if (chainRemainder(d) < 0) errors.push("Сумма частей больше исходной суммы");
  if (!d.throughCash && cents(chainRemainder(d)) !== 0) errors.push("Распределите исходную сумму полностью или переведите её в наличные с остатком");
  return [...new Set(errors)];
}
export function buildChainEntries(d: PaymentChainDraft, companies: ChainCompany[], makeId: () => string = () => crypto.randomUUID()): ChainEntry[] {
  const entries: ChainEntry[] = [];
  const source = companies.find(c => c.id === d.sourceCompanyId);
  const add = (role: ChainRole, amount: number, date: string, name: string, category: string, companyId: string, accountId: string, counterparty: string, allocationId: string | null) => {
    entries.push({role, allocationId, payment: {id: makeId(), amount, date, name, category, companyId, accountId, counterparty, status: "done", comment: encodeChainMetadata({id:d.id,revision:d.revision+1,amount:d.sourceAmount,date:d.sourceDate,label:d.label,role,allocationId}, "Исходная сумма: " + d.sourceAmount + " ₽ · " + d.label)}});
  };
  if (d.throughCash) {
    add("source", -d.sourceAmount, d.sourceDate, d.label, TRANSFER_CATEGORIES.outgoing, d.sourceCompanyId, d.sourceAccountId, "", null);
    add("cash-in", d.sourceAmount, d.sourceDate, "Переведено в наличные · " + d.label, TRANSFER_CATEGORIES.incoming, d.sourceCompanyId, d.cashAccountId, "", null);
  }
  for (const a of d.allocations) {
    if (a.excluded) continue;
    const recipient = companies.find(c => c.id === a.companyId);
    if (requiresKorovkinLoan(source, recipient)) {
      add("loan-out", -a.amount, d.sourceDate, "Займ " + recipient!.name, INTERCOMPANY_LOAN_CATEGORIES.issued, d.sourceCompanyId, d.cashAccountId, recipient!.name, a.id);
      add("loan-in", a.amount, d.sourceDate, "Получение займа от " + source!.name, LOAN_CATEGORIES.receipt, a.companyId, a.accountId, source!.name, a.id);
    }
    add(d.throughCash ? "spending" : "source", -a.amount, a.date, a.name, a.category, a.companyId, a.accountId, a.counterparty, a.id);
    if(a.category===TRANSFER_CATEGORIES.outgoing && a.targetAccountId) add("transfer-in",a.amount,a.date,"Поступление на кошелёк · "+a.name,TRANSFER_CATEGORIES.incoming,a.companyId,a.targetAccountId,a.counterparty,a.id);
  }
  return entries;
}

export interface PaymentChainSummary {id:string;label:string;amount:number|null;date:string;lastDate:string;count:number;revision:number;status:"active"|"cancelled";paymentId?:string;chainId?:string;sourceAccountId?:string|null;sourceCompanyId?:string|null}
