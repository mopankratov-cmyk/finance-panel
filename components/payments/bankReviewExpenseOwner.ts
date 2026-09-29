import { bankReviewSpendingSplits, isMainGroup, requiresFilippovLoan } from "@/lib/finance/paymentChains";
import { preferredAliasCompany } from "@/lib/finance/companyAliases";
import { decodeBankSplits, encodeBankSplits, type BankInstructionSplit } from "./bankInstructionSplits";
import type { BankReviewItem } from "./bankReviewStore";
import type { DdsCompany } from "./ddsCompanies";

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

export function mentionedCompanyId(item: BankReviewItem, companies: DdsCompany[]) {
  // The current review fields are the user's latest decision. In particular,
  // Korovkin/Filippov aliases must win over company names left in an old split.
  const currentText = normalize(`${item.counterparty} ${item.purpose}`);
  const currentAlias = preferredAliasCompany(
    currentText,
    companies.filter((company) => company.id !== item.companyId),
  );
  if (currentAlias) return currentAlias.id;

  const answer = normalize(`${item.managerAnswer ?? ""} ${item.counterparty} ${item.purpose}`);
  const direct = companies.find((company) => {
    const name = normalize(company.name).replace(/^(ип|ооо) /, "");
    return company.id !== item.companyId && Boolean(name) && answer.includes(name);
  });
  if (direct) return direct.id;
  return preferredAliasCompany(answer, companies.filter((company) => company.id !== item.companyId))?.id ?? null;
}

export function economicCompanyId(item: BankReviewItem, companies: DdsCompany[]) {
  const mentioned = companies.find((company) => company.id === mentionedCompanyId(item, companies));
  const source = companies.find((company) => company.id === item.companyId);
  if (requiresFilippovLoan(source, mentioned)) return mentioned!.id;
  if (isMainGroup(source) && isMainGroup(mentioned)) return item.companyId;
  const spending = bankReviewSpendingSplits(decodeBankSplits(item.managerAnswer) ?? []);
  if (spending.length === 1 && spending[0].companyId) return spending[0].companyId;
  return item.companyId;
}

/** Removes previously generated technical loan rows and keeps one economic expense. */
export function reconcileSimpleExpenseOwner(item: BankReviewItem, companies: DdsCompany[]) {
  if (item.amount >= 0) return item;
  const decoded = decodeBankSplits(item.managerAnswer);
  if (!decoded) return item;
  const spending = bankReviewSpendingSplits(decoded);
  if (spending.length !== 1) return item;
  const companyId = economicCompanyId(item, companies);
  if (!companyId || (decoded.length === 1 && spending[0].companyId === companyId)) return item;
  return { ...item, managerAnswer: encodeBankSplits([{ ...spending[0], companyId }]) };
}

export function expenseOwnerSplits(item: BankReviewItem, companyId: string): BankInstructionSplit[] {
  const current = bankReviewSpendingSplits(decodeBankSplits(item.managerAnswer) ?? []);
  const base = current.length === 1 ? current[0] : null;
  return [{
    id: base?.id ?? crypto.randomUUID(), amount: Math.abs(item.amount),
    description: base?.description || item.purpose || "Расход", category: item.category,
    companyId, accountId: item.accountId, flow: "expense", countsTowardBank: true,
    excluded: false, needsClarification: !item.category,
  }];
}
