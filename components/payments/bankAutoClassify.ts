import type { BankStatement, BankStatementRow } from "./bankStatement";
import type { DdsCompany } from "./ddsCompanies";
import type { Account, Payment } from "@/lib/types";
import { companyAliasKeys, sameCompanyAlias } from "@/lib/finance/companyAliases";

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

const STOP_WORDS = new Set(["без", "ндс", "оплата", "платеж", "сумма", "руб", "рублей", "счет", "счета", "перевод"]);

function words(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((word) => word.length >= 4 && !STOP_WORDS.has(word)));
}

function textSimilarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.min(a.size, b.size);
}

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
    [/\b(подбор.*персонал|поиск.*сотрудник|найм.*сотрудник|рекрут|headhunter|hh\.ru)\b/i, "Поиск и найм персонала", 0.86],
    [/\b(обучен.*сотрудник|медосмотр|спецодежд|корпоратив|расход.*персонал)\b/i, "Расходы на персонал", 0.82],
    [/\b(реклам|продвижен)\b/i, "Внутренняя реклама на МП", 0.78],
    [/\b(доставк|транспортн.*услуг)\b/i, "Доставка до маркеплейса", 0.72],
  ];
  for (const [pattern, category, confidence] of rules) {
    if (pattern.test(text)) return { category, confidence, reason: `Ключевые слова в назначении: «${category}»` };
  }
  return null;
}

export function categoryMatchesDirection(category: string | null, amount: number): boolean {
  if (!category) return true;
  const value = normalize(category);
  if (amount < 0 && /(продажи на мп|получение кредит|поступление|вклад.*собствен)/.test(value)) return false;
  if (amount > 0 && /(погашение|оплата|выбытие|выдача кредит|расход|налог|зарплат)/.test(value)) return false;
  return true;
}

export function requiresCounterparty(category: string | null): boolean {
  return Boolean(category && /зарплат|аванс.*зп/i.test(category));
}

function learnedCategory(row: BankStatementRow, payments: PaymentWithCompany[]) {
  const counterparty = normalize(row.counterparty);
  const purpose = `${row.counterparty} ${row.purpose}`;
  const similar = payments.filter((payment) => {
    if (payment.status !== "done") return false;
    const sameCounterparty = Boolean(counterparty) && normalize(payment.counterparty) === counterparty;
    const similarPurpose = textSimilarity(purpose, `${payment.counterparty} ${payment.name} ${payment.comment}`) >= 0.55;
    return sameCounterparty || similarPurpose;
  });
  if (similar.length === 0) return null;
  const counts = new Map<string, number>();
  for (const payment of similar) counts.set(payment.category, (counts.get(payment.category) ?? 0) + 1);
  const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = count / similar.length;
  if (count < 2 || share < 0.7) return null;
  return { category, confidence: Math.min(0.96, 0.72 + share * 0.22), reason: `Так уже разносили ${count} похожих платежей` };
}

function learnedOwnership(row: BankStatementRow, payments: PaymentWithCompany[]) {
  const matches = payments
    .filter((payment) => payment.status === "done" && textSimilarity(
      `${row.counterparty} ${row.purpose}`,
      `${payment.counterparty} ${payment.name} ${payment.comment}`,
    ) >= 0.62);
  // Одна похожая операция — не история, а совпадение слов: по ней нельзя
  // назначать юрлицо и кошелёк (у статьи тот же минимум — count < 2 → null).
  if (matches.length < 2) return null;
  const companyCounts = new Map<string, number>();
  const accountCounts = new Map<string, number>();
  for (const payment of matches) {
    if (payment.companyId) companyCounts.set(payment.companyId, (companyCounts.get(payment.companyId) ?? 0) + 1);
    if (payment.accountId) accountCounts.set(payment.accountId, (accountCounts.get(payment.accountId) ?? 0) + 1);
  }
  const best = (counts: Map<string, number>) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const company = best(companyCounts);
  const account = best(accountCounts);
  return {
    companyId: company && company[1] / matches.length >= 0.7 ? company[0] : null,
    accountId: account && account[1] / matches.length >= 0.7 ? account[0] : null,
    count: matches.length,
  };
}

function ownerCompany(statement: BankStatement, companies: DdsCompany[], mappings: BankAccountMapping[]) {
  const mapped = mappings.find((mapping) => mapping.bankAccountNumber === statement.accountNumber);
  if (mapped) return { companyId: mapped.companyId, confidence: 1, reason: "Компания запомнена для этого банковского счёта" };
  const owner = normalize(statement.owner).replace(/^индивидуальный предприниматель\s+/, "");
  // Владелец не распознан (банк пишет «Наименование:» вместо «Клиент:») —
  // `name.includes("")` было бы true для первой же компании, и вся выписка
  // уходила ей с уверенностью 0.94. Лучше «не знаю» и ручная проверка.
  if (!owner) return null;
  const aliasKeys = companyAliasKeys(owner);
  if (aliasKeys.length) {
    const aliased = companies.filter((item) => aliasKeys.some((key) => normalize(item.name).includes(key)));
    if (aliased.length === 1) {
      return { companyId: aliased[0].id, confidence: 1, reason: `Владелец «${statement.owner}» учтён как ${aliased[0].name} (справочник алиасов)` };
    }
  }
  const matched = companies.filter((item) => {
    const name = normalize(item.name).replace(/^ип\s+/, "");
    return name.length >= 3 && (owner.includes(name) || name.includes(owner));
  });
  // Две компании подошли под одного владельца — выбирать наугад нельзя.
  if (matched.length !== 1) return null;
  return { companyId: matched[0].id, confidence: 0.94, reason: "Компания определена по владельцу выписки" };
}

function mappedAccount(statement: BankStatement, mappings: BankAccountMapping[]) {
  const mapping = mappings.find((item) => item.bankAccountNumber === statement.accountNumber);
  return mapping ? { accountId: mapping.accountId, confidence: 1, reason: "Кошелёк запомнен для номера банковского счёта" } : null;
}

function accountFromNumber(statement: BankStatement, accounts: Account[]) {
  const number = statement.accountNumber.replace(/\D/g, "");
  if (!number) return null;
  const matched = accounts.filter((item) => {
    const digits = item.name.replace(/\D/g, "");
    return digits.length >= 4 && (digits.endsWith(number.slice(-4)) || number.endsWith(digits.slice(-4)));
  });
  // Два кошелька с одинаковым хвостом номера — ничья, а не «первый в списке».
  if (matched.length !== 1) return null;
  return { accountId: matched[0].id, confidence: 0.96, reason: "Кошелёк определён по номеру банковского счёта" };
}

function accountFromOwnerAndBank(statement: BankStatement, accounts: Account[]) {
  const ownerWords = words(statement.owner);
  const bankWords = words(statement.bank);
  const ranked = accounts.map((account) => {
    const name = normalize(account.name);
    let score = 0;
    for (const word of ownerWords) if (name.includes(word)) score += 2;
    for (const word of bankWords) if (name.includes(word)) score += 3;
    if (sameCompanyAlias(statement.owner, name)) score += 4;
    return { account, score };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 5 || ranked[0].score === ranked[1]?.score) return null;
  return { accountId: ranked[0].account.id, confidence: 0.91, reason: "Кошелёк определён по владельцу и банку выписки" };
}

export function classifyBankStatement(
  statement: BankStatement,
  accounts: Account[],
  companies: DdsCompany[],
  payments: PaymentWithCompany[],
  mappings: BankAccountMapping[],
): BankSuggestion[] {
  const company = ownerCompany(statement, companies, mappings);
  const account = mappedAccount(statement, mappings) ?? accountFromNumber(statement, accounts) ?? accountFromOwnerAndBank(statement, accounts);

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
      // Явное назначение банка важнее истории: прошлые ошибки не должны «обучать» новые строки.
      const best = keyword ?? (learned && categoryMatchesDirection(learned.category, row.amount) ? learned : null);
      if (best) {
        category = best.category;
        categoryConfidence = best.confidence;
        reasons.push(best.reason);
      }
    }

    if (!categoryMatchesDirection(category, row.amount)) {
      reasons.push(`Статья «${category}» противоречит знаку операции и сброшена`);
      category = null;
      categoryConfidence = 0;
    }

    const learned = learnedOwnership(row, payments);
    const rowCompany = company ?? (learned?.companyId ? { companyId: learned.companyId, confidence: 0.86, reason: `Компания определена по ${learned.count} похожим платежам в ДДС` } : null);
    const rowAccount = account ?? (learned?.accountId ? { accountId: learned.accountId, confidence: 0.86, reason: `Кошелёк определён по ${learned.count} похожим платежам в ДДС` } : null);
    if (rowCompany) reasons.push(rowCompany.reason);
    if (rowAccount) reasons.push(rowAccount.reason);
    const confidence = Math.min(categoryConfidence || 0, rowCompany?.confidence ?? 0, rowAccount?.confidence ?? 0);
    return {
      row,
      companyId: rowCompany?.companyId ?? null,
      accountId: rowAccount?.accountId ?? null,
      category,
      confidence,
      reasons,
      needsReview: !category || !rowCompany || !rowAccount || confidence < 0.85,
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
