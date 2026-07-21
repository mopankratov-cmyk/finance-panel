import type { BankReviewItem } from "./bankReviewStore";

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};

export interface ParsedManagerInstruction {
  itemId: string | null;
  amount: number | null;
  date: string | null;
  category: string | null;
  counterparty: string | null;
  explanation: string;
}

export function parseManagerInstruction(text: string, items: BankReviewItem[]): ParsedManagerInstruction {
  const normalized = text.toLowerCase().replace(/ё/g, "е");
  const amountMatch = normalized.match(/(\d[\d\s.,]*)\s*(т|тыс|к|млн)?\b/);
  let amount: number | null = null;
  if (amountMatch) {
    amount = Number(amountMatch[1].replace(/\s/g, "").replace(",", "."));
    if (amountMatch[2] && ["т", "тыс", "к"].includes(amountMatch[2])) amount *= 1000;
    if (amountMatch[2] === "млн") amount *= 1_000_000;
  }

  const dateMatch = normalized.match(/\b(\d{1,2})\s+([а-я]+)|\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
  let date: string | null = null;
  if (dateMatch) {
    const day = Number(dateMatch[1] ?? dateMatch[3]);
    const monthWord = dateMatch[2];
    const month = monthWord
      ? Object.entries(MONTHS).find(([prefix]) => monthWord.startsWith(prefix))?.[1]
      : Number(dateMatch[4]);
    let year = Number(dateMatch[5] ?? new Date().getFullYear());
    if (year < 100) year += 2000;
    if (month) date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  let category: string | null = null;
  if (/займ.*(выдал|выдач|михайлов|кому)|займ\s+[а-я]/i.test(normalized)) category = "Выдача кредитов и займов";
  else if (/возврат.*займ|вернул.*займ/i.test(normalized)) category = "Возврат кредитов и займов";
  else if (/дивиденд|личн.*нужд/i.test(normalized)) category = "Дивиденды";
  else if (/налог|фнс|усн/i.test(normalized)) category = "УСН";
  else if (/реклам/i.test(normalized)) category = "Внутренняя реклама на МП";

  const dashText = text.split(/[-—]/).slice(1).join(" ").trim();
  const counterpartyMatch = dashText.match(/(?:займ|оплата|перевод)\s+([А-ЯЁA-Z][\p{L}-]+)/u);
  const counterparty = counterpartyMatch?.[1] ?? null;

  const candidates = items.filter((item) => {
    const amountMatches = amount === null || Math.abs(Math.abs(item.amount) - amount) < 0.01;
    const dateMatches = date === null || item.date === date;
    return amountMatches && dateMatches;
  });
  const itemId = candidates.length === 1 ? candidates[0].id : null;
  const explanation = itemId
    ? "Найдена одна операция по дате и сумме"
    : candidates.length > 1
      ? `Найдено несколько операций (${candidates.length}) — выберите нужную вручную`
      : "Операция по указанным данным не найдена";
  return { itemId, amount, date, category, counterparty, explanation };
}
