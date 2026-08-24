// Вывод из оборота проданного по FBS.
//
// Порядок работы задан не нами, а тем, кто выводит коды (Оптима):
//   1. Раз в три дня в разделе «Поставки → ФБС» выгружаются завершённые заказы
//      с фильтром «товар выкуплен» — там КИЗ и цена реализации.
//   2. В «Аналитика → Отчёты → по возвратам и перемещению» за тот же период
//      выгружаются возвраты.
//   3. Из проданных вычитаются возвращённые: возврат снова попадает в оборот WB,
//      и выводить такой код нельзя.
//   4. Остаток уходит файлом: первым столбцом КИЗ, рядом цена реализации.
//
// Модуль намеренно чистый: ни сети, ни базы. Его задача — превратить две
// выгрузки в список к выводу и честно сказать, чего в них не хватило.
//
// Отличие от соседнего lib/wb/kizCodes.ts, который разбирает те же выгрузки для
// вкладки «КИЗ по брендам»: там возвраты берутся ТОЛЬКО по причине «возврат
// брака», потому что задача другая. Здесь вычитаются ВСЕ возвраты без разбора
// причины — любой вернувшийся товар снова в обороте.

import { parseExportDate, parseKizCode, type KizCode } from "@/lib/wb/kizCodes";

export interface SoldKizLine {
  lineNumber: number;
  code: KizCode;
  /** Код как он лежал в выгрузке — его и отправляем, не пересобирая. */
  rawCode: string;
  taskId: string;
  article: string;
  barcode: string;
  nmId: number | null;
  /** Цена реализации из выгрузки. null — колонки не было или ячейка пуста. */
  price: number | null;
  soldAt: string | null;
}

export interface ReturnedKizLine {
  lineNumber: number;
  code: KizCode;
  article: string;
  returnedAt: string | null;
  reason: string;
}

export interface KizParseIssue {
  /** Номер строки в файле — чтобы человек мог открыть и посмотреть. */
  line: number;
  reason: string;
}

export interface SoldParseResult {
  lines: SoldKizLine[];
  /** Строки, где кода нет или он не распознан. */
  issues: KizParseIssue[];
  /** Найденные колонки — показываем человеку, что именно прочитали. */
  columns: Record<string, string>;
  withoutPrice: number;
}

export interface ReturnsParseResult {
  lines: ReturnedKizLine[];
  issues: KizParseIssue[];
  columns: Record<string, string>;
}

const SOLD_ALIASES = {
  code: ["кодмаркировки", "киз", "маркировка", "честныйзнак", "кодмаркировкикиз", "datamatrix", "dm", "sgtin"],
  taskId: ["номерзадания", "задание", "идзадания", "rid", "srid", "сборочноезадание", "номерсборочногозадания", "номерзаказа"],
  article: ["артикулпродавца", "артикул", "vendorcode", "sku"],
  barcode: ["штрихкод", "шк", "баркод", "barcode"],
  nmId: ["артикулwb", "nmid", "номенклатура", "кодwb"],
  price: [
    "цена", "ценареализации", "ценапродажи", "суммапродажи", "ксумме", "квыплате",
    "фактическаяцена", "ценасоскидкой", "ценасосппруб", "ценарозничная", "розничнаяцена",
    "суммазаказа", "стоимость", "ценаруб", "итоговаяцена",
  ],
  soldAt: ["датапродажи", "датазаказа", "датазавершения", "дата", "датаотгрузки", "датавыкупа"],
} as const;

const RETURN_ALIASES = {
  code: ["кодмаркировки", "киз", "маркировка", "честныйзнак", "кодмаркировкикиз", "datamatrix", "dm", "sgtin"],
  article: ["артикулпродавца", "артикул", "vendorcode", "sku"],
  returnedAt: ["датавозврата", "датаприёмки", "датаприемки", "датаоперации", "дата"],
  reason: ["причина", "причинавозврата", "типвозврата", "статус", "видоперации", "операция"],
} as const;

const normalize = (value: unknown) =>
  String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "");
const clean = (value: unknown, max = 255) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

/** Цена из ячейки: «1 234,56 ₽» → 1234.56. Не число — null, а не ноль. */
export function parsePrice(value: unknown): number | null {
  const text = clean(value, 40).replace(/\s| /g, "").replace(/₽|руб\.?/gi, "").replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function detectColumns<K extends string>(rows: string[][], aliases: Record<K, readonly string[]>) {
  let best: { row: number; indexes: Partial<Record<K, number>>; score: number } | null = null;
  for (let row = 0; row < Math.min(30, rows.length); row += 1) {
    const indexes: Partial<Record<K, number>> = {};
    (rows[row] ?? []).forEach((cell, index) => {
      const header = normalize(cell);
      if (!header) return;
      for (const [field, list] of Object.entries(aliases) as [K, readonly string[]][]) {
        if (indexes[field] === undefined && list.includes(header)) indexes[field] = index;
      }
    });
    const score = Object.keys(indexes).length;
    if (!best || score > best.score) best = { row, indexes, score };
  }
  if (!best) throw new Error("Файл пуст — строку заголовков найти не удалось");
  const columns: Record<string, string> = {};
  for (const [field, index] of Object.entries(best.indexes) as [K, number][]) {
    columns[field] = clean(rows[best.row][index], 120);
  }
  return { headerRow: best.row, indexes: best.indexes, columns };
}

/** Выгрузка завершённых заказов ФБС с фильтром «товар выкуплен». */
export function parseSoldKiz(rows: string[][]): SoldParseResult {
  const { headerRow, indexes, columns } = detectColumns(rows, SOLD_ALIASES);
  if (indexes.code === undefined) {
    throw new Error("В выгрузке проданного нет колонки кода маркировки — собирать список не из чего");
  }

  const lines: SoldKizLine[] = [];
  const issues: KizParseIssue[] = [];
  let withoutPrice = 0;
  const at = (row: string[], field: keyof typeof SOLD_ALIASES) =>
    indexes[field] === undefined ? "" : (row[indexes[field]!] ?? "");

  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((cell) => !clean(cell))) continue;
    const rawCode = clean(at(row, "code"), 512);
    if (!rawCode) {
      issues.push({ line: index + 1, reason: "нет кода маркировки" });
      continue;
    }
    const code = parseKizCode(rawCode);
    if (!code.code) {
      issues.push({ line: index + 1, reason: "код не распознан — ожидается код идентификации из 31 символа" });
      continue;
    }
    const price = parsePrice(at(row, "price"));
    if (price === null) withoutPrice += 1;
    const nm = clean(at(row, "nmId"), 40).replace(/\s/g, "");
    lines.push({
      lineNumber: index + 1,
      code,
      rawCode,
      taskId: clean(at(row, "taskId"), 120).replace(/\s+/g, ""),
      article: clean(at(row, "article"), 255),
      barcode: clean(at(row, "barcode"), 120).replace(/\s/g, ""),
      nmId: /^\d+$/.test(nm) && Number(nm) > 0 ? Number(nm) : null,
      price,
      soldAt: parseExportDate(at(row, "soldAt")),
    });
  }

  if (lines.length === 0 && issues.length === 0) throw new Error("После строки заголовков нет данных");
  return { lines, issues, columns, withoutPrice };
}

/** Отчёт по возвратам и перемещению товара. Причину не фильтруем: вернувшееся
 *  снова в обороте вне зависимости от того, почему оно вернулось. */
export function parseReturnedKiz(rows: string[][]): ReturnsParseResult {
  const { headerRow, indexes, columns } = detectColumns(rows, RETURN_ALIASES);
  if (indexes.code === undefined) {
    throw new Error("В отчёте возвратов нет колонки кода маркировки — вычитать нечего");
  }

  const lines: ReturnedKizLine[] = [];
  const issues: KizParseIssue[] = [];
  const at = (row: string[], field: keyof typeof RETURN_ALIASES) =>
    indexes[field] === undefined ? "" : (row[indexes[field]!] ?? "");

  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((cell) => !clean(cell))) continue;
    const rawCode = clean(at(row, "code"), 512);
    if (!rawCode) continue;
    const code = parseKizCode(rawCode);
    if (!code.code) {
      issues.push({ line: index + 1, reason: "код возврата не распознан" });
      continue;
    }
    lines.push({
      lineNumber: index + 1,
      code,
      article: clean(at(row, "article"), 255),
      returnedAt: parseExportDate(at(row, "returnedAt")),
      reason: clean(at(row, "reason"), 255),
    });
  }

  return { lines, issues, columns };
}

export interface WithdrawalPlanInput {
  sold: SoldKizLine[];
  returned: ReturnedKizLine[];
  /** Коды, уже отправленные на вывод раньше, — второй раз не отправляем. */
  alreadySent: Set<string>;
  /** Коды, уже помеченные возвращёнными раньше. */
  alreadyReturned: Set<string>;
}

export interface WithdrawalPlan {
  /** Пойдут в файл: код и цена реализации. */
  toWithdraw: SoldKizLine[];
  /** Вычтены, потому что вернулись в оборот WB. */
  excludedByReturn: SoldKizLine[];
  /** Уже отправлялись раньше — из файла исключены, но это не ошибка. */
  alreadySent: SoldKizLine[];
  /** Дубли внутри самой выгрузки. */
  duplicates: number;
  /**
   * Вернулись ПОСЛЕ того, как код уже ушёл на вывод. Молча это не исправить:
   * код у Оптимы уже выведен, и вернуть его в оборот может только человек.
   */
  returnedAfterSent: ReturnedKizLine[];
  /** Возвраты, которым не нашлось проданного кода ни в этой выгрузке, ни в реестре. */
  returnsWithoutSale: number;
}

/** Свести проданное и возвраты в список к выводу. */
export function buildWithdrawalPlan(input: WithdrawalPlanInput): WithdrawalPlan {
  const returnedCodes = new Set(input.returned.map((line) => line.code.code!).filter(Boolean));
  const seen = new Set<string>();

  const toWithdraw: SoldKizLine[] = [];
  const excludedByReturn: SoldKizLine[] = [];
  const alreadySent: SoldKizLine[] = [];
  let duplicates = 0;

  for (const line of input.sold) {
    const code = line.code.code!;
    if (seen.has(code)) { duplicates += 1; continue; }
    seen.add(code);

    if (returnedCodes.has(code) || input.alreadyReturned.has(code)) { excludedByReturn.push(line); continue; }
    if (input.alreadySent.has(code)) { alreadySent.push(line); continue; }
    toWithdraw.push(line);
  }

  const returnedAfterSent = input.returned.filter(
    (line) => input.alreadySent.has(line.code.code!) && !seen.has(line.code.code!),
  );
  const returnsWithoutSale = input.returned.filter(
    (line) => !seen.has(line.code.code!) && !input.alreadySent.has(line.code.code!),
  ).length;

  return { toWithdraw, excludedByReturn, alreadySent, duplicates, returnedAfterSent, returnsWithoutSale };
}
