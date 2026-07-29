export interface TaraLine {
  lineNumber: number;
  container: string;
  nmId: number | null;
  article: string;
  barcode: string;
  quantity: number;
  volumeLiters: number | null;
}

export interface TaraParseResult {
  headerRow: number;
  columns: Partial<Record<"container" | "nmId" | "article" | "barcode" | "quantity" | "volumeLiters", string>>;
  lines: TaraLine[];
  errors: string[];
  warnings: string[];
  summary: { containers: number; skuRows: number; quantity: number; volumeLiters: number };
}

const ALIASES: Record<keyof TaraParseResult["columns"], string[]> = {
  container: ["короб", "номеркороба", "коробка", "тара", "контейнер", "container", "box", "boxnumber"],
  nmId: ["nmid", "номенклатураwb", "артикулwb", "кодноменклатурыwb", "wildberriesid"],
  article: ["артикул", "артикулпродавца", "vendorcode", "sellercode", "article", "sku"],
  barcode: ["шк", "штрихкод", "баркод", "barcode", "ean", "ean13"],
  quantity: ["количество", "колво", "количествошт", "qty", "quantity", "шт", "units"],
  volumeLiters: ["объем", "объём", "объемл", "объёмл", "литры", "volume", "volumeliters"],
};

const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "");
const clean = (value: unknown, max = 255) => String(value ?? "").normalize("NFKC").trim().slice(0, max);
const positiveNumber = (value: unknown) => Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));

function detect(rows: string[][]) {
  let best: { row: number; indexes: Partial<Record<keyof TaraParseResult["columns"], number>>; score: number } | null = null;
  for (let row = 0; row < Math.min(30, rows.length); row++) {
    const indexes: Partial<Record<keyof TaraParseResult["columns"], number>> = {};
    rows[row].forEach((cell, index) => {
      const header = normalize(cell);
      for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
        if (indexes[field] === undefined && aliases.includes(header)) indexes[field] = index;
      }
    });
    const score = Object.keys(indexes).length;
    if (!best || score > best.score) best = { row, indexes, score };
  }
  if (!best || best.indexes.container === undefined || best.indexes.quantity === undefined) {
    throw new Error("Не найдены обязательные колонки: короб/тара и количество");
  }
  if (best.indexes.nmId === undefined && best.indexes.article === undefined && best.indexes.barcode === undefined) {
    throw new Error("Нужна хотя бы одна колонка идентификатора: nmId, артикул или штрихкод");
  }
  return best;
}

export function parseTaraRows(rows: string[][]): TaraParseResult {
  const detected = detect(rows);
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed: TaraLine[] = [];
  const value = (row: string[], field: keyof TaraParseResult["columns"]) => detected.indexes[field] === undefined ? "" : row[detected.indexes[field]!];

  for (let index = detected.row + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.every((cell) => !clean(cell))) continue;
    const container = clean(value(row, "container"), 120);
    const article = clean(value(row, "article"), 255);
    const barcode = clean(value(row, "barcode"), 120);
    const nmRaw = clean(value(row, "nmId"), 40);
    const nmId = nmRaw && /^\d+$/.test(nmRaw) && Number(nmRaw) > 0 ? Number(nmRaw) : null;
    const quantity = positiveNumber(value(row, "quantity"));
    const volumeRaw = clean(value(row, "volumeLiters"), 40);
    const volumeLiters = volumeRaw ? positiveNumber(volumeRaw) : null;
    const rowErrors: string[] = [];
    if (!container) rowErrors.push("нет номера короба");
    if (!nmId && !article && !barcode) rowErrors.push("нет nmId, артикула или ШК");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) rowErrors.push("некорректное количество");
    if (volumeLiters !== null && (!Number.isFinite(volumeLiters) || volumeLiters < 0 || volumeLiters > 1_000_000)) rowErrors.push("некорректный объём");
    if (rowErrors.length) {
      if (errors.length < 50) errors.push(`Строка ${index + 1}: ${rowErrors.join(", ")}`);
      continue;
    }
    parsed.push({ lineNumber: index + 1, container, nmId, article, barcode, quantity, volumeLiters });
  }
  if (!parsed.length && !errors.length) errors.push("После строки заголовков нет данных");

  const merged = new Map<string, TaraLine>();
  for (const line of parsed) {
    const key = `${normalize(line.container)}|${line.nmId ?? ""}|${normalize(line.article)}|${normalize(line.barcode)}`;
    const previous = merged.get(key);
    if (!previous) merged.set(key, line);
    else {
      previous.quantity += line.quantity;
      previous.volumeLiters = previous.volumeLiters === null || line.volumeLiters === null ? null : previous.volumeLiters + line.volumeLiters;
      if (!warnings.includes("Повторяющиеся позиции внутри одного короба объединены")) warnings.push("Повторяющиеся позиции внутри одного короба объединены");
    }
  }
  const lines = [...merged.values()];
  const columns: TaraParseResult["columns"] = {};
  for (const [field, column] of Object.entries(detected.indexes) as [keyof TaraParseResult["columns"], number][]) columns[field] = clean(rows[detected.row][column]);
  return {
    headerRow: detected.row + 1,
    columns,
    lines,
    errors,
    warnings,
    summary: {
      containers: new Set(lines.map((line) => normalize(line.container))).size,
      skuRows: lines.length,
      quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      volumeLiters: lines.reduce((sum, line) => sum + (line.volumeLiters ?? 0), 0),
    },
  };
}
