import type { BankReviewItem } from "./bankReviewStore";
import type { DdsCompany } from "./ddsCompanies";

export const BANK_SPLIT_PREFIX = "__bank_split_v1:";

export interface BankInstructionSplit {
  id: string;
  amount: number;
  description: string;
  category: string | null;
  companyId: string | null;
  excluded: boolean;
  needsClarification: boolean;
  flow?: "income" | "expense";
  accountId?: string | null;
  countsTowardBank?: boolean;
}

export interface ParsedBankInstruction {
  itemId: string | null;
  date: string;
  bankAmount: number;
  splits: BankInstructionSplit[];
  message: string;
}

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

function money(value: string, suffix = "") {
  let result = Number(value.replace(/\s/g, "").replace(",", "."));
  if (/^(?:т|тыс|к)$/i.test(suffix)) result *= 1000;
  return result;
}

function categoryFor(description: string) {
  const value = normalize(description);
  if (/комисси/.test(value)) return "РКО";
  if (/рекламн.*(?:кабинет|вб|wb)|пополнил.*реклам/.test(value)) return "Внутренняя реклама на МП";
  if (/\bзп\b|зарплат/.test(value)) return "Зарплата административного персонала";
  if (/\bусн\b|налог/.test(value)) return "УСН";
  if (/\bпо\b|программ|марпл|эцп|искусственн.*интеллект|покупка ии|телефон/.test(value)) return "ПО";
  if (/карт|озон банк|т банк|сбербанк|перевод/.test(value)) return "Выбытие — Перевод между счетами";
  return null;
}

function companyFor(description: string, companies: DdsCompany[]) {
  const value = normalize(description);
  const aliases = value.includes("филиппов") ? ["коровкин", "филиппов"] : [];
  for (const company of companies) {
    const name = normalize(company.name).replace(/^ип |^ооо /, "");
    if ((name && value.includes(name)) || aliases.some((alias) => normalize(company.name).includes(alias))) return company.id;
  }
  return null;
}

function splitDescription(value: string, total: number, companies: DdsCompany[]): BankInstructionSplit[] {
  const clean = value.replace(/^\s*[-—]\s*/, "").trim();
  const token = /(?:^|,|;)\s*(\d[\d\s]*(?:[.,]\d+)?)\s*(тыс|т|к|руб|р)?(?=\s|$|[-—,;])/gi;
  const matches = [...clean.matchAll(token)];
  if (matches.length === 0) {
    const excluded = /не вносить в ддс|никак не вносить|забрала свои/.test(normalize(clean));
    return [{
      id: crypto.randomUUID(), amount: total, description: clean || "Без пояснения",
      category: excluded ? null : categoryFor(clean), companyId: companyFor(clean, companies), excluded,
      needsClarification: /уточнить|не знаю|что это/.test(normalize(clean)),
    }];
  }
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? clean.length;
    const description = clean.slice(start, end).replace(/^\s*[-—]\s*/, "").replace(/[,;]\s*$/, "").trim();
    const excluded = /не вносить в ддс|никак не вносить|забрала свои/.test(normalize(description));
    return {
      id: crypto.randomUUID(), amount: money(match[1], match[2]), description: description || "Без пояснения",
      category: excluded ? null : categoryFor(description), companyId: companyFor(description, companies), excluded,
      needsClarification: /уточнить|не знаю|что это/.test(normalize(description)),
    };
  });
}

export function parseBankInstructionList(
  text: string,
  items: BankReviewItem[],
  companies: DdsCompany[],
  year = new Date().getFullYear(),
): ParsedBankInstruction[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let currentDate = "";
  const result: ParsedBankInstruction[] = [];
  for (const line of lines) {
    const date = line.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
    if (date) {
      let parsedYear = Number(date[3] ?? year);
      if (parsedYear < 100) parsedYear += 2000;
      currentDate = `${parsedYear}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
      continue;
    }
    const operation = line.match(/^(\d[\d\s]*(?:[.,]\d+)?)\s*(т|тыс|к|р|руб)?\b\s*(.*)$/i);
    if (!operation || !currentDate) continue;
    const bankAmount = money(operation[1], operation[2]);
    const candidates = items.filter((item) => item.date === currentDate && Math.abs(Math.abs(item.amount) - bankAmount) < 0.01);
    const itemId = candidates.length === 1 ? candidates[0].id : null;
    result.push({
      itemId,
      date: currentDate,
      bankAmount,
      splits: splitDescription(operation[3], bankAmount, companies),
      message: candidates.length === 1 ? "Найдена операция" : candidates.length > 1 ? `Найдено операций: ${candidates.length}` : "Операция не найдена",
    });
  }
  return result;
}

export function splitTotal(splits: BankInstructionSplit[]) {
  return Math.round(splits.reduce((sum, split) => sum + split.amount, 0) * 100) / 100;
}

export function splitNetTotal(item: Pick<BankReviewItem, "amount">, splits: BankInstructionSplit[]) {
  return Math.round(splits.reduce((sum, split) => {
    const flow = split.flow ?? (item.amount < 0 ? "expense" : "income");
    return sum + (flow === "expense" ? -split.amount : split.amount);
  }, 0) * 100) / 100;
}

export function splitBankTotal(item: Pick<BankReviewItem, "amount">, splits: BankInstructionSplit[]) {
  return Math.round(splits.reduce((sum, split) => {
    if (split.countsTowardBank === false) return sum;
    const flow = split.flow ?? (item.amount < 0 ? "expense" : "income");
    return sum + (flow === "expense" ? -split.amount : split.amount);
  }, 0) * 100) / 100;
}

export function splitAccountId(item: Pick<BankReviewItem, "accountId">, split: BankInstructionSplit) {
  return split.accountId === undefined ? item.accountId : split.accountId;
}

export function encodeBankSplits(splits: BankInstructionSplit[]) {
  return `${BANK_SPLIT_PREFIX}${JSON.stringify(splits)}`;
}

export function decodeBankSplits(value: string | null): BankInstructionSplit[] | null {
  if (!value?.startsWith(BANK_SPLIT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(BANK_SPLIT_PREFIX.length));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function splitsAreReady(item: BankReviewItem, splits: BankInstructionSplit[]) {
  return Math.abs(splitBankTotal(item, splits) - item.amount) < 0.01
    && splits.length > 0
    && splits.every((split) => split.excluded || (split.amount > 0 && split.category && split.companyId && splitAccountId(item, split) && !split.needsClarification));
}
