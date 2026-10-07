import type { BankStatementRow } from "./bankStatement";

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/**
 * Банки иногда кладут в колонку контрагента последнее распознанное ФИО,
 * хотя сама строка содержит только способ перевода. Такое имя не является
 * реквизитом получателя и не должно обучать следующие операции.
 */
export function trustedBankCounterparty(row: Pick<BankStatementRow, "amount" | "counterparty" | "purpose">) {
  const purpose = normalize(row.purpose);
  const counterparty = normalize(row.counterparty);
  if (/выдач[а-я]* наличн[а-я]*.*банкомат|снят[а-я]* наличн[а-я]*.*банкомат/.test(purpose)) return "";

  const genericCardTransfer = /перевод (?:сбп|на карту)|перевод в (?:т[- ]?банк|сбербанк|альфа[- ]?банк|озон банк)/.test(purpose);
  const namedParty = /(?:получатель|перевод (?:для|от)|в пользу)\s+[а-яa-z]/.test(purpose);
  if (genericCardTransfer && !namedParty) return "";

  const explicitParty = purpose.match(/(?:получатель|перевод (?:для|от)|в пользу)\s+([^.;]+)/)?.[1] ?? "";
  if (explicitParty && counterparty) {
    const words = (value: string) => new Set(value.split(/[^a-zа-я0-9]+/).filter((word) => word.length >= 4));
    const stated = words(explicitParty);
    const selected = words(counterparty);
    if (stated.size && selected.size && ![...stated].some((word) => selected.has(word))) return "";
  }

  return row.counterparty.trim();
}

export function destinationBankFromPurpose(purpose: string) {
  const match = purpose.match(/перевод\s+в\s+(t[- ]?bank|т[- ]?банк|сбербанк|альфа[- ]?банк|озон\s+банк|вб\s+банк)/i);
  if (!match) return "";
  const value = normalize(match[1]);
  if (/^(?:t[- ]?bank|т[- ]?банк)$/.test(value)) return "Т-Банк";
  if (value === "сбербанк") return "СберБанк";
  if (value === "альфа-банк" || value === "альфа банк") return "Альфа-Банк";
  if (value === "озон банк") return "Ozon Банк";
  if (value === "вб банк") return "ВБ Банк";
  return match[1].trim();
}
