// Разбор таблицы выплат ПО КОЛОНКАМ: заголовок таблицы → роль → ячейка строки.
//
// Почему не по тексту строки (см. parsePayoutRow.mjs — он остаётся запасным
// путём для вёрстки без заголовков). Живой кабинет WB, 21.08.2026, отчёты
// реализации: 20 колонок, суммы БЕЗ знака рубля («7 051 195.73»), и рядом
// стоят «Продажа», «К перечислению за товар» и «Итого к оплате». На отчёте
// 813379425 это 131.5 млн / 102.4 млн / 87.3 млн — три разных числа, и в
// календарь должно попасть последнее. Никакой якорь внутри строки этого не
// различает: «к перечислению» указывает как раз на НЕ ту колонку.
//
// Поэтому роль колонки определяется по её заголовку, а приоритет ролей —
// явный список: чем ниже в списке, тем сильнее кандидат.

/** Заголовки суммы к выплате, от слабого к сильному. */
const AMOUNT_HEADERS = [
  /^сумма$/i,
  /сумма\s+(?:к\s+)?(?:выплат|перечислен)/i,
  /к\s+перечислению(?!\s+за\s+товар)/i,
  /итого\s+к\s+(?:оплате|перечислению|выплате)/i,
];

/** Заголовки даты. «Дата формирования»/«создания» — НЕ день выплаты. */
const PAYOUT_DATE_HEADERS = [
  /дата\s+(?:создания|формирования)/i,
  /дата\s+(?:зачислен|поступлен)/i,
  /дата\s+(?:выплаты|перечисления|платежа|оплаты)/i,
];
const WEAK_DATE_HEADERS = [/дата\s+(?:создания|формирования)/i];

const REPORT_HEADERS = [/№\s*отч[её]та|номер\s+отч[её]та/i, /id\s+заявки|№\s*заявки|номер\s+заявки/i];
const PERIOD_HEADERS = [/период/i];
const STATUS_HEADERS = [/статус/i];

function bestIndex(headers, patterns) {
  let best = -1;
  let rank = -1;
  headers.forEach((header, index) => {
    const text = String(header ?? "").replace(/\s+/g, " ").trim();
    patterns.forEach((pattern, patternRank) => {
      if (pattern.test(text) && patternRank > rank) {
        rank = patternRank;
        best = index;
      }
    });
  });
  return { index: best, rank };
}

/**
 * Роли колонок по заголовкам таблицы.
 * @returns {{ reportId: number, period: number, amount: number, date: number, status: number, dateIsWeak: boolean }}
 */
export function mapColumns(headers) {
  const amount = bestIndex(headers, AMOUNT_HEADERS);
  const date = bestIndex(headers, PAYOUT_DATE_HEADERS);
  return {
    reportId: bestIndex(headers, REPORT_HEADERS).index,
    period: bestIndex(headers, PERIOD_HEADERS).index,
    amount: amount.index,
    date: date.index,
    status: bestIndex(headers, STATUS_HEADERS).index,
    // Дата формирования отчёта — не день выплаты. Такую дату нельзя выдавать
    // за факт: панель подставит свой расчётный день и скажет об этом.
    dateIsWeak: date.index >= 0 && WEAK_DATE_HEADERS.some((pattern) => pattern.test(String(headers[date.index] ?? ""))),
  };
}

/** Число из ячейки: «87 310 418.87», «-12 500,00 ₽», «1 234». */
export function cellAmount(cell) {
  const text = String(cell ?? "").replace(/ | /g, " ").trim();
  const match = text.match(/^(-|−|–)?\s*(\d{1,3}(?:[\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?$/i);
  if (!match) return null;
  const value = Number(match[2].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return match[1] ? -value : value;
}

/** Дата из ячейки: «17.08.2026» → «2026-08-17». */
export function cellDate(cell) {
  const match = String(cell ?? "").match(/(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(20\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Период из ячейки: «с 10.08.2026 по 16.08.2026». */
export function cellPeriod(cell) {
  const dates = [...String(cell ?? "").matchAll(/(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(20\d{2})/g)]
    .map((match) => `${match[3]}-${match[2]}-${match[1]}`);
  return dates.length >= 2 ? { from: dates[0], to: dates[1] } : { from: null, to: null };
}

const SENT_RE = /(?:отправлен|перечислен|выплачен|зачислен|проведена?\s+банком|успешно\s+проведен)[оыа]?(?![а-яё])/i;
const AWAITING_RE = /ожида|обрабатывает|в\s+обработк|ручную\s+обработк|запланирован|к\s+перечислению|к\s+выплате/i;

/** Статус строки; null — по этой строке нельзя сказать, отправлены деньги или нет. */
export function cellState(cell) {
  const text = String(cell ?? "");
  if (SENT_RE.test(text)) return "marketplace_sent";
  if (AWAITING_RE.test(text)) return "awaiting_transfer";
  return null;
}

/**
 * @typedef {{
 *   marketplace: string, cabinetId: string, companyId: string, accountId: string,
 *   externalId: string, reportId: string | null,
 *   periodFrom: string | null, periodTo: string | null,
 *   plannedDate: string | null, amount: number, state: string, capturedAt: string,
 * }} PayoutTableRow
 */

/**
 * Одна строка таблицы → снимок выплаты.
 * @param {string[]} cells
 * @param {ReturnType<typeof mapColumns>} columns
 * @param {{ marketplace: string, cabinetId: string, companyId: string, accountId: string }} target
 * @param {{ defaultState?: string }} [options]
 * @returns {{ row: PayoutTableRow } | { skipped: string }}
 */
export function parsePayoutTableRow(cells, columns, target, options = {}) {
  const at = (index) => (index >= 0 && index < cells.length ? cells[index] : "");
  if (columns.amount < 0) return { skipped: "в таблице нет колонки с суммой выплаты" };

  const amount = cellAmount(at(columns.amount));
  if (amount === null) return { skipped: "сумма в колонке выплаты не читается как число" };
  // Ноль — это не выплата, а пустая строка отчёта (например, отчёт без продаж).
  if (amount === 0) return { skipped: "нулевая сумма выплаты" };

  const period = cellPeriod(at(columns.period));
  const reportId = String(at(columns.reportId) ?? "").trim() || null;
  const stablePart = reportId || (period.from && period.to ? `${period.from}:${period.to}` : null);
  if (!stablePart) return { skipped: "нет ни номера отчёта, ни периода — снимок нечем опознать" };

  // Дата: только настоящий день выплаты. Дату формирования отчёта не выдаём
  // за неё — снимок уходит без даты, и панель честно оставляет расчётный день.
  const plannedDate = columns.dateIsWeak ? null : cellDate(at(columns.date));
  const state = cellState(at(columns.status)) ?? options.defaultState ?? null;
  if (!state) return { skipped: "статус строки не опознан" };

  return { row: {
    marketplace: target.marketplace,
    cabinetId: target.cabinetId,
    companyId: target.companyId,
    accountId: target.accountId,
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
 * Таблица целиком.
 * @param {string[]} headers заголовки колонок
 * @param {string[][]} rows ячейки строк
 * @param {{ marketplace: string, cabinetId: string, companyId: string, accountId: string }} target
 * @param {{ defaultState?: string }} [options]
 * @returns {{ columns: ReturnType<typeof mapColumns>, rows: PayoutTableRow[], skipped: Record<string, number> }}
 */
export function parsePayoutTable(headers, rows, target, options = {}) {
  const columns = mapColumns(headers);
  const parsed = [];
  const skipped = new Map();
  for (const cells of rows) {
    const result = parsePayoutTableRow(cells, columns, target, options);
    if ("row" in result) parsed.push(result.row);
    else skipped.set(result.skipped, (skipped.get(result.skipped) ?? 0) + 1);
  }
  return { columns, rows: parsed, skipped: Object.fromEntries(skipped) };
}
