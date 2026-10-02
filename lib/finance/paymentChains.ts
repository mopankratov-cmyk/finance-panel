import type { Account, Payment } from "@/lib/types";
import { companyAliasKeys, preferredAliasCompany, sameCompanyAlias } from "./companyAliases";
import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES, TRANSFER_CATEGORIES } from "./categories";

export interface ChainCompany { id: string; name: string; groupName: string }
export interface ChainAllocation {
  id: string; amount: number; date: string; name: string; category: string;
  companyId: string; accountId: string; targetAccountId?: string; targetReviewId?: string; counterparty: string; excluded: boolean;
}
export interface PaymentChainFundingLink {
  chainId: string; allocationId: string; companyId: string; amount: number;
}
export interface PaymentChainFundingLot extends PaymentChainFundingLink { date: string }
export interface PaymentChainDraft {
  id: string; revision: number; label: string; sourceDate: string; sourceAmount: number;
  sourceAccountId: string; sourceCompanyId: string; cashAccountId: string;
  throughCash: boolean; allocations: ChainAllocation[]; originPaymentIds: string[];
  bankReviewId: string | null;
  /** Конкретные пополнения транзитного/личного кошелька, из которых оплачен расход. */
  sourceFundingLinks?: PaymentChainFundingLink[];
  sourceFundingCandidateCompanyIds?: string[];
  sourceFundingSelectionRequired?: boolean;
}
export type ChainRole = "source" | "cash-in" | "loan-out" | "loan-in" | "transfer-in" | "spending";
export interface ChainEntry { payment: Payment; role: ChainRole; allocationId: string | null }
export interface ChainMetadata { id: string; revision: number; amount: number; date: string; label: string; role: ChainRole; allocationId?: string | null }
export interface ChainHistory { revision: number; createdAt: string; reason: string; entries: ChainEntry[] }
export interface PaymentChainBankTarget {
  id: string; date: string; amount: number; purpose: string; accountId: string;
  companyId: string; sourceFileName: string; status: string; allocatedAmount: number; availableAmount: number;
}
export interface PaymentChainDetail { draft: PaymentChainDraft; status: "active" | "cancelled"; migrationAvailable: boolean; history: ChainHistory[]; bankTargets: PaymentChainBankTarget[] }
export interface BankReviewChainSplit {
  amount: number; category: string | null; excluded?: boolean;
  flow?: "income" | "expense"; countsTowardBank?: boolean; isRemainder?: boolean;
}
const cents = (n: number) => Math.round(n * 100);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const accountNorm = (s: string) => norm(s).replace(/[^а-яa-z0-9]+/g, " ").trim();

/** FIFO attribution for money kept on a personal/transit wallet. */
export function allocateWalletFunding(lots: readonly PaymentChainFundingLot[], amount: number): PaymentChainFundingLink[] | null {
  const links: PaymentChainFundingLink[]=[];let remainder=cents(amount);
  for(const lot of [...lots].sort((left,right)=>left.date.localeCompare(right.date)||left.chainId.localeCompare(right.chainId))){
    if(remainder<=0)break;const used=Math.min(cents(lot.amount),remainder);if(used>0)links.push({chainId:lot.chainId,allocationId:lot.allocationId,companyId:lot.companyId,amount:used/100});remainder-=used;
  }
  return remainder===0&&links.length>0&&new Set(links.map(link=>link.companyId)).size===1?links:null;
}

/** Кассы фактического ДДС. PANKSTER GROUP используется только календарём. */
export function chainCashAccounts(accounts: readonly Account[]) {
  return accounts.filter((account) => account.type === "cash" && account.currency === "RUB" && !/pankster\s+group/i.test(account.name));
}

/**
 * Выбирает кассу юрлица без ручного перебора технических кошельков.
 * Сначала берём кассу с названием компании. Для контура Филиппова общая
 * «Наличка» — его историческая касса; «Наличные» остаются запасной общей
 * кассой. Это устраняет ручной выбор при наличии обеих старых касс.
 */
export function preferredChainCashAccount(company: ChainCompany | undefined, accounts: readonly Account[], companies: readonly ChainCompany[]) {
  if (!company) return null;
  const cash = chainCashAccounts(accounts);
  const companyName = accountNorm(company.name);
  const named = cash.filter((account) => {
    const name = accountNorm(account.name);
    return name.includes(companyName) || sameCompanyAlias(account.name, company.name);
  });
  if (named.length === 1) return named[0];
  const companyNames = companies.map((candidate) => accountNorm(candidate.name)).filter(Boolean);
  const generic = cash.filter((account) => {
    const name = accountNorm(account.name);
    return /^(?:наличка|наличные|касса)$/.test(name) && !companyNames.some((candidate) => name.includes(candidate));
  });
  if (generic.length === 1) return generic[0];
  if (companyAliasKeys(company.name).includes("филиппов")) {
    return generic.find((account) => accountNorm(account.name) === "наличка")
      ?? generic.find((account) => accountNorm(account.name) === "наличные")
      ?? null;
  }
  return null;
}

/** Заполняет известную цепочку кассами и каноническим получателем до показа формы. */
export function autofillPaymentChainCash(draft: PaymentChainDraft, companies: readonly ChainCompany[], accounts: readonly Account[]) {
  const next: PaymentChainDraft = {...draft, allocations:draft.allocations.map(allocation=>({...allocation}))};
  const source=companies.find(company=>company.id===next.sourceCompanyId);
  for(const allocation of next.allocations) {
    // An explicitly selected bank statement row already identifies the owner.
    if(allocation.targetReviewId)continue;
    const recipient=preferredAliasCompany(`${allocation.name} ${allocation.counterparty}`,companies);
    if(recipient&&requiresFilippovLoan(source,recipient))allocation.companyId=recipient.id;
  }
  if(!next.allocations.some(allocation=>requiresFilippovLoan(source,companies.find(company=>company.id===allocation.companyId))))return next;
  next.throughCash=true;
  const sourceCash=preferredChainCashAccount(source,accounts,companies);
  if(!next.cashAccountId&&sourceCash)next.cashAccountId=sourceCash.id;
  for(const allocation of next.allocations) {
    const recipient=companies.find(company=>company.id===allocation.companyId);
    if(!requiresFilippovLoan(source,recipient)) {
      if(next.cashAccountId)allocation.accountId=next.cashAccountId;
      continue;
    }
    const current=accounts.find(account=>account.id===allocation.accountId);
    const recipientCash=preferredChainCashAccount(recipient,accounts,companies);
    if((!current||current.type!=="cash"||current.currency!=="RUB"||current.id===next.cashAccountId)&&recipientCash)allocation.accountId=recipientCash.id;
  }
  return next;
}

/**
 * A row from the recipient's bank statement is the authoritative destination:
 * its account and company must move together. This also turns a transfer between
 * the main group and Filippov into the required cash/loan chain automatically.
 */
export function selectPaymentChainBankTarget(
  draft: PaymentChainDraft,
  allocationId: string,
  target: PaymentChainBankTarget,
  companies: readonly ChainCompany[],
  accounts: readonly Account[],
) {
  const recipient=companies.find(company=>company.id===target.companyId);
  const updated: PaymentChainDraft={
    ...draft,
    allocations:draft.allocations.map(allocation=>allocation.id===allocationId?{
      ...allocation,
      companyId:target.companyId,
      category:TRANSFER_CATEGORIES.outgoing,
      name:allocation.name||`Внесение на банковский счёт ${recipient?.name??"получателя"}`,
      date:target.date,
      targetAccountId:target.accountId,
      targetReviewId:target.id,
    }:{...allocation}),
  };
  return autofillPaymentChainCash(updated,companies,accounts);
}
export function isMainGroup(company: ChainCompany | undefined) {
  return Boolean(company && /основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей/.test(norm(company.groupName + " " + company.name)) && !companyAliasKeys(company.name).length);
}
export function requiresFilippovLoan(source: ChainCompany | undefined, recipient: ChainCompany | undefined) {
  if (!source || !recipient || source.id === recipient.id || sameCompanyAlias(source.name, recipient.name)) return false;
  const sourceIsFilippov = companyAliasKeys(source.name).includes("филиппов");
  const recipientIsFilippov = companyAliasKeys(recipient.name).includes("филиппов");
  return (isMainGroup(source) && recipientIsFilippov) || (sourceIsFilippov && isMainGroup(recipient));
}

/** Technical loan and wallet-transfer entries are generated from one allocation. */
export function bankReviewSpendingSplits<T extends BankReviewChainSplit>(splits: readonly T[]) {
  const flow = (split: T) => split.flow ?? "expense";
  const technicalLoan = (split: T) => split.category === INTERCOMPANY_LOAN_CATEGORIES.issued || split.category === LOAN_CATEGORIES.receipt;
  const downstream = splits.filter((split) => !split.excluded && !split.isRemainder
    && split.countsTowardBank === false && flow(split) === "expense" && !technicalLoan(split));
  if (downstream.length) return downstream;
  return splits.filter((split) => !split.excluded && !split.isRemainder
    && split.countsTowardBank !== false && flow(split) === "expense" && !technicalLoan(split));
}
// Только НЕисключённые части: buildChainEntries ниже для excluded-частей не
// создаёт ни одной записи платежа — включать их сумму сюда значило бы
// считать деньги распределёнными там, где их разнесение в ДДС на самом деле
// пропущено. С этим совпадением chainRemainder/validateChain (при
// throughCash=false, где remainder обязан быть строго 0) молча пропускали
// сохранение цепочки с исключённой частью: allocationTotal засчитывал её как
// уже распределённую, buildChainEntries эту же часть просто выбрасывал — и
// сумма реального банковского оттока переставала существовать в ДДС вообще,
// без единой ошибки при сохранении.
export function allocationTotal(draft: PaymentChainDraft) {
  return draft.allocations.reduce((sum, p) => sum + (p.excluded ? 0 : cents(p.amount)), 0) / 100;
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

/** Обычный проведённый платёж из выписки не является разбивкой сам по себе. */
export function isLegacyPaymentSplit(parts: readonly unknown[]) {
  return parts.length > 1;
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
  if (d.throughCash && (!cash || cash.type !== "cash" || cash.currency !== "RUB")) errors.push("Выберите рублёвый кошелёк наличных компании-источника");
  if (d.throughCash && d.sourceAccountId === d.cashAccountId) errors.push("Кошелёк источника и кошелёк пополнения наличных должны отличаться");
  for (const [allocationIndex, a] of d.allocations.entries()) {
    if (!Number.isFinite(a.amount) || cents(a.amount) <= 0 || a.amount !== cents(a.amount)/100 || !validDate(a.date) || a.date < d.sourceDate) errors.push("Каждой части нужны сумма до копеек и дата не раньше исходного перевода");
    if (a.excluded) continue;
    const recipient = companies.find(c => c.id === a.companyId);
    const account = accounts.find(acc => acc.id === a.accountId);
    const missing: string[] = [];
    if (!a.name.trim()) missing.push("назначение");
    if (!recipient) missing.push("компанию в поле «Чей расход / кому»");
    if (!account || account.currency !== "RUB") missing.push("рублёвый кошелёк");
    // Пустая статья допустима: пользователь может пока не знать назначение.
    // Такая запись остаётся в ДДС в разделе «Без статьи» для последующего разбора.
    if (a.category && !categories.includes(a.category)) missing.push("допустимую статью");
    if (missing.length) {
      const amount = Number.isFinite(a.amount) ? `, ${a.amount.toLocaleString("ru-RU")} ₽` : "";
      errors.push(`Часть ${allocationIndex + 1}${amount}: укажите ${missing.join(", ")}`);
    }
    if(a.category===TRANSFER_CATEGORIES.outgoing) {
      const target=accounts.find(acc=>acc.id===a.targetAccountId);
      if(!target || target.currency!=="RUB" || target.id===a.accountId)errors.push("У перевода между кошельками выберите другой рублёвый кошелёк поступления");
      if(d.bankReviewId && target?.type==="bank" && !a.targetReviewId)errors.push("Для внесения на банковский счёт выберите встречное поступление из выписки");
    }
    if (/Поступление|Получение кредитов|Продажи на МП/.test(a.category)) errors.push("У части расхода выбрана статья поступления");
    if (/зарплат/i.test(a.category) && !a.counterparty.trim()) errors.push("Для зарплаты укажите получателя в каждой части");
    if (requiresFilippovLoan(source, recipient) && (!d.throughCash || account?.type !== "cash")) errors.push("Расход между основной группой и контуром ИП Филиппова оформляется займом через наличные: выберите наличные источника и получателя");
    if (d.throughCash && !requiresFilippovLoan(source, recipient) && a.accountId !== d.cashAccountId) errors.push("Обычный расход этой суммы должен идти из её наличного кошелька");
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
    if (requiresFilippovLoan(source, recipient)) {
      add("loan-out", -a.amount, d.sourceDate, "Займ " + recipient!.name, INTERCOMPANY_LOAN_CATEGORIES.issued, d.sourceCompanyId, d.cashAccountId, recipient!.name, a.id);
      add("loan-in", a.amount, d.sourceDate, "Получение займа от " + source!.name, LOAN_CATEGORIES.receipt, a.companyId, a.accountId, source!.name, a.id);
    }
    add(d.throughCash ? "spending" : "source", -a.amount, a.date, a.name, a.category, a.companyId, a.accountId, a.counterparty, a.id);
    if(a.category===TRANSFER_CATEGORIES.outgoing && a.targetAccountId) add("transfer-in",a.amount,a.date,"Поступление на кошелёк · "+a.name,TRANSFER_CATEGORIES.incoming,a.companyId,a.targetAccountId,a.counterparty,a.id);
  }
  return entries;
}

export interface PaymentChainSummary {id:string;label:string;amount:number|null;date:string;lastDate:string;count:number;revision:number;status:"active"|"cancelled";paymentId?:string;chainId?:string;sourceAccountId?:string|null;sourceCompanyId?:string|null}
