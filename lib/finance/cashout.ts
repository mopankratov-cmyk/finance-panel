import type { Payment } from "@/lib/types";

export type CashoutKind = "atm" | "individual" | "sbp" | "atm_deposit";

export type CashoutCandidate = Pick<Payment, "amount" | "name" | "counterparty" | "comment" | "importSource">;

const ORGANISATION = /(?:^|\s)(?:ооо|ао|пао|зао|ип|нко|банк|фнс|уфк|казначейств|маркетплейс)(?:\s|$)/i;
const PERSON_NAME = /^[а-яё-]+(?:\s+(?:[а-яё-]+|[а-яё]\.?|[а-яё]\.?[а-яё]\.?)){1,3}$/i;
const TRANSFER = /перевод|перечислен/i;

/**
 * Определяет операции, которые собственник должен вернуть на расчётный счёт.
 * Внутригрупповые переводы уже связаны парой в ДДС и сюда не относятся.
 */
export function cashoutKind(payment: CashoutCandidate): CashoutKind | null {
  if (!/^(?:bank-review|dds-chain):/i.test(payment.importSource ?? "")) return null;
  if (/\[dds-bank-transfer:[^\]]+\]/i.test(payment.comment ?? "")) return null;

  const purpose = `${payment.name ?? ""} ${payment.comment ?? ""}`.replace(/\s+/g, " ").trim();
  const counterparty = (payment.counterparty ?? "").replace(/\s+/g, " ").trim();
  const searchable = `${purpose} ${counterparty}`;

  if (Number(payment.amount) > 0) {
    return /внесен(?:ие|ия)[^.]{0,60}(?:налич|банкомат|\batm\b)|взнос\s+налич|пополнен(?:ие|ия)[^.]{0,50}(?:банкомат|налич)|прием\s+налич|самоинкассац|\b(?:cash deposit|atm deposit)\b/i.test(searchable) ? "atm_deposit" : null;
  }
  if (Number(payment.amount) === 0) return null;

  if (/\b(?:atm|cash withdrawal)\b|банкомат|снят(?:ие|ия|о)\s+налич|выдач[аи]\s+налич|получен(?:ие|ия)\s+налич/i.test(searchable)) return "atm";
  if (/(?:^|[^а-яё])сбп(?:[^а-яё]|$)|систем[аы]\s+быстр(?:ых|ые)\s+платеж/i.test(searchable)) return "sbp";
  if (/физ(?:ическ(?:ому|ого)?\s+лиц[ау]?|лиц)|частн(?:ому|ого)\s+лиц[ау]?|p2p|card\s*2\s*card|перевод[^.]{0,60}(?:на\s+карт|по\s+номеру\s+(?:телефон|мобильн))/i.test(searchable)) return "individual";
  if (TRANSFER.test(purpose) && counterparty && !ORGANISATION.test(counterparty) && PERSON_NAME.test(counterparty)) return "individual";
  return null;
}

export function isCashoutPayment(payment: CashoutCandidate): boolean {
  return cashoutKind(payment) !== null;
}

export function isCashoutCompanyName(name: string): boolean {
  const normalized = name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();
  const tokens = normalized.split(" ");
  return tokens.includes("панкратов") || tokens.includes("рио");
}
