import type { BankReviewItem } from "./bankReviewStore";
import type { DdsCompany } from "./ddsCompanies";
import { companyAliasKeys } from "@/lib/finance/companyAliases";

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
  isRemainder?: boolean;
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
  if (/^(?:т|тыс|тысяч[аи]?|к)$/i.test(suffix)) result *= 1000;
  return result;
}

function categoryFor(description: string) {
  const value = normalize(description);
  if (/дивиденд/.test(value)) return "Дивиденды";
  if (/комисси/.test(value)) return "РКО";
  if (/рекламн.*(?:кабинет|вб|wb)|пополнил.*реклам/.test(value)) return "Внутренняя реклама на МП";
  if (/(?:^|[^а-я])зп(?:$|[^а-я])|зарплат/.test(value)) return "Зарплата административного персонала";
  if (/\bусн\b|налог/.test(value)) return "УСН";
  if (/\bпо\b|программ|марпл|эцп|искусственн.*интеллект|покупка ии|телефон/.test(value)) return "ПО";
  if (/карт|озон банк|т банк|сбербанк|перевод/.test(value)) return "Выбытие — Перевод между счетами";
  return null;
}

function companyFor(description: string, companies: DdsCompany[]) {
  const value = normalize(description);
  const aliases = companyAliasKeys(value);
  for (const company of companies) {
    const name = normalize(company.name).replace(/^ип |^ооо /, "");
    if ((name && value.includes(name)) || aliases.some((alias) => normalize(company.name).includes(alias))) return company.id;
  }
  return null;
}

function splitDescription(value: string, total: number, companies: DdsCompany[]): BankInstructionSplit[] {
  const clean = value.replace(/^\s*[-—]\s*/, "").trim();
  const token = /(?:^|,|;)\s*(\d[\d\s]*(?:[.,]\d+)?)\s*(тысяч[аи]?|тыс|т|к|руб|р)?(?=\s|$|[-—,;])/gi;
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
  const months = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  const result: ParsedBankInstruction[] = [];
  for (const originalLine of lines) {
    let line = originalLine;
    const wordDate = line.match(/^(\d{1,2})\s+([а-я]+)\s*/i);
    const month = wordDate ? months.findIndex((prefix) => wordDate[2].toLowerCase().startsWith(prefix)) + 1 : 0;
    if (wordDate && month) {
      currentDate = [year, String(month).padStart(2, "0"), wordDate[1].padStart(2, "0")].join("-");
      line = line.slice(wordDate[0].length).trim();
      if (!line) continue;
    }
    const date = line.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$)\s*/);
    if (date) {
      let parsedYear = Number(date[3] ?? year);
      if (parsedYear < 100) parsedYear += 2000;
      currentDate = `${parsedYear}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
      line = line.slice(date[0].length).trim();
      if (!line) continue;
    }
    line = line.replace(/^из\s+/i, "");
    const operation = line.match(/^(\d[\d\s]*(?:[.,]\d+)?)\s*(тысяч[аи]?|тыс|т|к|руб|р)?(?=\s|$|[-—])\s*(.*)$/i);
    if (!operation || !currentDate) continue;
    const bankAmount = money(operation[1], operation[2]);
    const candidates = items.filter((item) => item.date === currentDate && Math.abs(Math.abs(item.amount) - bankAmount) < 0.01);
    const itemId = candidates.length === 1 ? candidates[0].id : null;
    result.push({
      itemId,
      date: currentDate,
      bankAmount,
      splits: balanceBankSplits(itemId ? candidates[0] : { amount: -bankAmount, companyId: null, accountId: null },
        splitDescription(operation[3], bankAmount, companies).map((split) => ({
          ...split, companyId: split.companyId ?? (itemId ? candidates[0].companyId : null),
        }))),
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

export function balanceBankSplits(item: Pick<BankReviewItem, "amount" | "companyId" | "accountId">, splits: BankInstructionSplit[]): BankInstructionSplit[] {
  const parts = splits.filter((split) => !split.isRemainder);
  const remainder = Math.round((item.amount - splitBankTotal(item, parts)) * 100) / 100;
  if (Math.abs(remainder) < 0.01 || remainder * item.amount <= 0) return parts;
  return [...parts, {
    id: splits.find((split) => split.isRemainder)?.id ?? crypto.randomUUID(),
    description: "Остаток — укажите назначение", category: null,
    companyId: item.companyId, accountId: item.accountId, excluded: false,
    needsClarification: true, isRemainder: true, countsTowardBank: true,
    flow: item.amount < 0 ? "expense" : "income",
    ...splits.find((split) => split.isRemainder),
    amount: Math.abs(remainder),
  }];
}
