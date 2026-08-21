// Разбор строки раздела выплат маркетплейса. Вынесен из collector.mjs, чтобы
// проверяться тестами на реальных строках, а не «на глаз».
//
// Главное правило: это ДЕНЬГИ, и они уходят в календарь выплат. Позиционные
// догадки («первая сумма в строке», «первая дата») недопустимы: в строке WB
// рядом стоят реализация, комиссия и сумма к перечислению, а дат бывает три —
// начало периода, конец периода и день выплаты. Поэтому парсер требует явный
// якорь у колонки, а при неоднозначности МОЛЧИТ (возвращает null), и строка
// просто не попадает в снимок. Пропущенная выплата видна и чинится; выплата с
// чужой суммой или чужой датой тихо врёт в финансовом плане.

const DATE_RE = /(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(20\d{2})/g;
// Минус (обычный, юникодный, en-dash) — часть числа: удержания и возвраты
// приходят отрицательными, и терять знак нельзя.
const AMOUNT_RE = /(-|−|–)?\s?(\d{1,3}(?:[\s ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб)/gi;

/** Якоря суммы к перечислению — то, что реально выплачивается продавцу. */
const PAYOUT_AMOUNT_ANCHORS = [
  /к\s+перечислению/i,
  /к\s+выплате/i,
  /сумма\s+выплаты/i,
  /итого\s+к\s+(?:выплате|перечислению)/i,
  /к\s+переводу/i,
];

/** Якоря даты перечисления. */
const PAYOUT_DATE_ANCHORS = [
  /дата\s+выплаты/i,
  /дата\s+перечисления/i,
  /выплата\s+(?:будет\s+)?(?:произведена|назначена)?\s*(?:на|:)?/i,
  /перечислени[ея]\s*(?:на|:)?/i,
];

function toNumber(sign, digits) {
  const value = Number(String(digits).replace(/[\s ]/g, "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return sign ? -value : value;
}

/** Все суммы строки с их позицией — чтобы понимать, что рядом с якорем. */
export function allAmounts(text) {
  const found = [];
  for (const match of String(text).matchAll(AMOUNT_RE)) {
    const value = toNumber(match[1], match[2]);
    if (value === null) continue;
    found.push({ value, index: match.index ?? 0, raw: match[0] });
  }
  return found;
}

export function allDates(text) {
  const found = [];
  for (const match of String(text).matchAll(DATE_RE)) {
    found.push({ iso: `${match[3]}-${match[2]}-${match[1]}`, index: match.index ?? 0, raw: match[0] });
  }
  return found;
}

/** Ближайшее значение ПОСЛЕ якоря: в таблицах подпись стоит перед числом. */
function valueAfterAnchor(text, anchors, items) {
  for (const anchor of anchors) {
    const hit = String(text).match(anchor);
    if (!hit || hit.index === undefined) continue;
    const after = items.filter((item) => item.index >= hit.index).sort((a, b) => a.index - b.index)[0];
    if (after) return after;
  }
  return null;
}

/**
 * Сумма к перечислению. Есть якорь — берём число рядом с ним; якоря нет и
 * сумма в строке ровно одна — она однозначна; иначе молчим.
 */
export function payoutAmount(text) {
  const amounts = allAmounts(text);
  if (!amounts.length) return null;
  const anchored = valueAfterAnchor(text, PAYOUT_AMOUNT_ANCHORS, amounts);
  if (anchored) return Math.round(anchored.value * 100) / 100;
  if (amounts.length === 1) return Math.round(amounts[0].value * 100) / 100;
  return null; // несколько сумм без якоря — какая из них выплата, неизвестно
}

/**
 * Дата перечисления. Якорь → дата рядом с ним. Без якоря: если дата ровно одна
 * и она не входит в период отчёта — берём; иначе молчим (начало периода —
 * не день выплаты).
 */
/**
 * @param {string} text
 * @param {{ from: string | null, to: string | null }} [period]
 * @returns {string | null}
 */
export function payoutDate(text, period = { from: null, to: null }) {
  const dates = allDates(text);
  if (!dates.length) return null;
  const anchored = valueAfterAnchor(text, PAYOUT_DATE_ANCHORS, dates);
  if (anchored) return anchored.iso;
  const outsidePeriod = dates.filter((date) => date.iso !== period.from && date.iso !== period.to);
  if (outsidePeriod.length === 1) return outsidePeriod[0].iso;
  return null;
}

export function parsePeriod(text) {
  const normalized = String(text);
  const explicit = normalized.match(
    /(?:за\s+период|период)\s*(?:с\s*)?((?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.20\d{2})\s*(?:по|[-–—])\s*((?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.20\d{2})/i,
  );
  const toIso = (value) => { const [d, m, y] = value.split("."); return `${y}-${m}-${d}`; };
  if (explicit) return { from: toIso(explicit[1]), to: toIso(explicit[2]) };
  const dates = allDates(normalized);
  if (dates.length >= 2 && dates[0].iso <= dates[1].iso) return { from: dates[0].iso, to: dates[1].iso };
  return { from: null, to: null };
}

// «К перечислению» — подпись колонки суммы, а не статус: если считать её
// признаком отправки, календарь заявит, что деньги уже ушли, хотя они только
// запланированы. Поэтому вырезаем её из текста перед проверкой статуса.
// Граница слова \b в JS считается по ASCII и после кириллицы НЕ срабатывает:
// /перечислен[оы]\b/ не матчит «перечислено». Границу задаём явным «дальше не
// буква», иначе статус «Перечислено» молча не распознаётся.
const SENT_RE = /(?:отправлен|перечислен|выплачен|зачислен)[оыа]?(?![а-яё])/i;
const AWAITING_RE = /ожида(?:ет|ется)|к\s+перечислению|к\s+выплате|запланирован/i;

export function payoutState(text) {
  const withoutColumnLabels = String(text).replace(/к\s+перечислению/gi, " ").replace(/к\s+выплате/gi, " ");
  if (SENT_RE.test(withoutColumnLabels)) return "marketplace_sent";
  if (AWAITING_RE.test(text)) return "awaiting_transfer";
  return null;
}

/** Идентификатор отчёта: только похожее на номер, а не любое слово рядом. */
export function reportIdOf(text) {
  const match = String(text).match(/(?:номер\s+документа(?:\s+оплаты)?|отч[её]т[а-я]*|report|№)\s*[:№]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,40})/i);
  const candidate = match?.[1] ?? null;
  if (!candidate) return null;
  // «Отчёт о реализации» дал бы reportId = "реализации" — один и тот же для всех
  // строк, и снимки схлопнулись бы в одну запись.
  if (!/\d/.test(candidate)) return null;
  return candidate;
}

/**
 * @typedef {{
 *   marketplace: string,
 *   cabinetId: string,
 *   companyId: string,
 *   accountId: string,
 *   externalId: string,
 *   reportId: string | null,
 *   periodFrom: string | null,
 *   periodTo: string | null,
 *   plannedDate: string,
 *   amount: number,
 *   state: string,
 *   capturedAt: string,
 * }} PayoutSnapshotRow
 */

/**
 * Разбор с причиной отказа — чтобы при установке было видно, ЧТО именно не
 * распозналось на живой странице, а не только «строк нет».
 * @param {string} text
 * @param {{ marketplace: string, cabinetId: string, companyId: string, accountId: string }} target
 * @returns {{ row: PayoutSnapshotRow } | { skipped: string }}
 */
export function parsePayoutRowDetailed(text, target) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  const state = payoutState(normalized);
  if (!state) return { skipped: "нет признака статуса выплаты" };

  const period = parsePeriod(normalized);
  const amount = payoutAmount(normalized);
  if (amount === null) return { skipped: "сумма к перечислению не опознана по подписи колонки" };
  const plannedDate = payoutDate(normalized, period);
  if (!plannedDate) return { skipped: "дата выплаты не опознана по подписи колонки" };

  const reportId = reportIdOf(normalized);
  const stablePart = reportId || (period.from && period.to ? `${period.from}:${period.to}` : null);
  if (!stablePart) return { skipped: "нет ни номера отчёта, ни периода — снимок нечем опознать" };

  return { row: {
    marketplace: target.marketplace,
    cabinetId: target.cabinetId,
    companyId: target.companyId,
    accountId: target.accountId,
    // Кабинет — часть ключа: без него две компании с одинаковым периодом
    // перезаписывали бы снимки друг друга.
    externalId: `${target.marketplace}:${target.cabinetId}:${stablePart}`,
    reportId,
    periodFrom: period.from,
    periodTo: period.to,
    plannedDate,
    amount,
    state,
    capturedAt: new Date().toISOString(),
  } };
}

/**
 * @param {string} text
 * @param {{ marketplace: string, cabinetId: string, companyId: string, accountId: string }} target
 * @returns {PayoutSnapshotRow | null}
 */
export function parsePayoutRow(text, target) {
  const result = parsePayoutRowDetailed(text, target);
  return "row" in result ? result.row : null;
}
