import type { BankStatement, BankStatementRow } from "./bankStatement";
import type { DdsCompany } from "./ddsCompanies";
import type { Account, Payment } from "@/lib/types";

export interface BankAccountMapping {
  bankAccountNumber: string;
  accountId: string;
  companyId: string;
  ownerInn: string;
}

export interface BankSuggestion {
  row: BankStatementRow;
  companyId: string | null;
  accountId: string | null;
  category: string | null;
  confidence: number;
  reasons: string[];
  needsReview: boolean;
  transferCandidateId: string | null;
}

type PaymentWithCompany = Payment & { companyId?: string | null };

const normalize = (value: string) => value.toLowerCase().replace(/[«»"'.,;:()]/g, " ").replace(/\s+/g, " ").trim();

function keywordCategory(row: BankStatementRow): { category: string; confidence: number; reason: string } | null {
  const text = normalize(`${row.counterparty} ${row.purpose}`);
  const rules: Array<[RegExp, string, number]> = [
    [/\b(фнс|налог|усн|единый налоговый)\b/i, "УСН", 0.94],
    [/\b(комисси|обслуживан.*счет|расчетно кассов)\b/i, "РКО", 0.9],
    [/\b(дивиденд|личн.*нужд|собственник)\b/i, "Дивиденды", 0.86],
    [/\b(процент.*кредит|процент.*займ)\b/i, "Оплата % по кредиту", 0.9],
    [/\b(получен.*займ|получен.*кредит)\b/i, "Получение кредитов и займов", 0.88],
    [/\b(выдач.*займ|займ.*михайлов|предоставлен.*займ)\b/i, "Выдача кредитов и займов", 0.88],
    [/\b(возврат.*займ|погашен.*займ|погашен.*кредит)\b/i, "Оплаты по кредитам и займам", 0.84],
    [/\b(реклам|продвижен)\b/i, "Внутренняя реклама на МП", 0.78],
    [/\b(доставк|транспортн.*услуг)\b/i, "Доставка до маркеплейса", 0.72],
  ];
  for (const [pattern, category, confidence] of rules) {
    if (pattern.test(text)) return { category, confidence, reason: `Ключевые слова в назначении: «${category}»` };
  }
  return null;
}

function learnedCategory(row: BankStatementRow, payments: PaymentWithCompany[]) {
  const counterparty = normalize(row.counterparty);
  if (!counterparty) return null;
  const similar = payments.filter((payment) => normalize(payment.counterparty) === counterparty && payment.status === "done");
  if (similar.length === 0) return null;
  const counts = new Map<string, number>();
  for (const payment of similar) counts.set(payment.category, (counts.get(payment.category) ?? 0) + 1);
  const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = count / similar.length;
  if (count < 2 || share < 0.7) return null;
  return { category, confidence: Math.min(0.96, 0.72 + share * 0.22), reason: `Так уже разносили ${count} похожих платежей` };
}

function ownerCompany(statement: BankStatement, companies: DdsCompany[], mappings: BankAccountMapping[]) {
  const mapped = mappings.find((mapping) => mapping.bankAccountNumber === statement.accountNumber);
  if (mapped) return { companyId: mapped.companyId, confidence: 1, reason: "Компания запомнена для этого банковского счёта" };
  const owner = normalize(statement.owner).replace(/^индивидуальный предприниматель\s+/, "");
  if (owner.includes("филиппов")) {
    const korovkin = companies.find((item) => normalize(item.name).includes("коровкин"));
    if (korovkin) {
      return {
        companyId: korovkin.id,
        confidence: 1,
        reason: "ИП Филиппов учтён как ИП Коровкин",
      };
    }
  }
  const company = companies.find((item) => {
    const name = normalize(item.name).replace(/^ип\s+/, "");
    return owner.includes(name) || name.includes(owner);
  });
  return company ? { companyId: company.id, confidence: 0.94, reason: "Компания определена по владельцу выписки" } : null;
}

function mappedAccount(statement: BankStatement, mappings: BankAccountMapping[]) {
  const mapping = mappings.find((item) => item.bankAccountNumber === statement.accountNumber);
  return mapping ? { accountId: mapping.accountId, confidence: 1, reason: "Кошелёк запомнен для номера банковского счёта" } : null;
}

export function classifyBankStatement(
  statement: BankStatement,
  accounts: Account[],
  companies: DdsCompany[],
  payments: PaymentWithCompany[],
  mappings: BankAccountMapping[],
): BankSuggestion[] {
  void accounts;
  const company = ownerCompany(statement, companies, mappings);
  const account = mappedAccount(statement, mappings);

  return statement.rows.map((row) => {
    const reasons: string[] = [];
    let category: string | null = null;
    let categoryConfidence = 0;

    if (row.counterpartyInn && row.counterpartyInn === statement.ownerInn) {
      category = row.amount >= 0 ? "Поступление — Перевод между счетами" : "Выбытие — Перевод между счетами";
      categoryConfidence = 0.98;
      reasons.push("ИНН совпадает с владельцем: перевод между своими счетами");
    } else {
      const learned = learnedCategory(row, payments);
      const keyword = keywordCategory(row);
      const best = [learned, keyword].filter(Boolean).sort((a, b) => b!.confidence - a!.confidence)[0];
      if (best) {
        category = best.category;
        categoryConfidence = best.confidence;
        reasons.push(best.reason);
      }
    }

    if (company) reasons.push(company.reason);
    if (account) reasons.push(account.reason);
    const confidence = Math.min(categoryConfidence || 0, company?.confidence ?? 0, account?.confidence ?? 0);
    return {
      row,
      companyId: company?.companyId ?? null,
      accountId: account?.accountId ?? null,
      category,
      confidence,
      reasons,
      needsReview: !category || !company || !account || confidence < 0.85,
      transferCandidateId: null,
    };
  });
}

export function matchInternalTransfers(suggestions: BankSuggestion[]): BankSuggestion[] {
  const result = suggestions.map((item) => ({ ...item }));
  for (let i = 0; i < result.length; i++) {
    if (result[i].transferCandidateId || !result[i].category?.includes("Перевод между счетами")) continue;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].transferCandidateId || result[i].row.amount !== -result[j].row.amount) continue;
      const days = Math.abs(Date.parse(result[i].row.date) - Date.parse(result[j].row.date)) / 86400000;
      if (days > 2) continue;
      result[i].transferCandidateId = result[j].row.id;
      result[j].transferCandidateId = result[i].row.id;
      result[i].reasons.push("Найдена встречная операция с той же суммой");
      result[j].reasons.push("Найдена встречная операция с той же суммой");
      break;
    }
  }
  return result;
}
