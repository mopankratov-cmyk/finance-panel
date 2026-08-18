/**
 * Разбор выгрузок WB под вкладку «КИЗ по брендам».
 *
 * Модуль намеренно чистый: ни сети, ни node-API — его импортируют и роут, и
 * клиентский компонент. Всё, что нельзя вывести из данных честно (ИНН владельца
 * кода, человекочитаемое имя бренда для непризнанного артикула), остаётся null.
 */

export type KizScheme = "FBS" | "DBS";

/**
 * Техническая группировка кодов по началу GTIN — НЕ владелец кода.
 *
 * Мульти-ИП: один кабинет может продавать коды нескольких ИП (агентская схема),
 * но узнать, чей код, по самому коду нельзя: нужен реестр GS1 или выгрузка ЧЗ.
 * inn/label — заготовка, всегда null: источника нет, выдумывать нельзя.
 */
export interface KizCodeGroupRef {
  inn: string | null;
  label: string | null;
  gtinPrefix: string | null;
}

export interface KizCode {
  /** Исходная строка ячейки после нормализации (с криптохвостом). */
  raw: string;
  /** Код идентификации: 31 символ, криптохвост отрезан. null — не распознан. */
  code: string | null;
  gtin: string | null;
  serial: string | null;
  /**
   * Первые 9 знаков GTIN. Это НЕ идентификатор владельца: длина префикса GS1
   * переменная (7–10 знаков) и без реестра GS1 не определяется, поэтому такая
   * нарезка может слить двух разных ИП в одну группу или разбить одного на две.
   * Годится только как технический ключ группировки/фильтра.
   */
  gtinPrefix: string | null;
}

export interface KizSaleLine {
  lineNumber: number;
  scheme: KizScheme;
  taskId: string;
  nmId: number | null;
  article: string;
  barcode: string;
  soldAt: string | null;
  code: KizCode | null;
}

export interface KizReturnLine {
  lineNumber: number;
  nmId: number | null;
  article: string;
  barcode: string;
  returnedAt: string | null;
  reason: string;
  code: KizCode | null;
}

export type KizSourceKind = "fbs" | "dbs" | "returns";

export interface KizBrandExport {
  brand: string;
  /** Техническая группа по началу GTIN, а не владелец кода. */
  codeGroup: KizCodeGroupRef;
  codes: string[];
  duplicatesRemoved: number;
  sources: { fbs: number; dbs: number; returns: number };
}

export interface KizSalesParseResult {
  headerRow: number;
  columns: Partial<Record<"taskId" | "nmId" | "article" | "barcode" | "soldAt" | "code", string>>;
  lines: KizSaleLine[];
  errors: string[];
  warnings: string[];
}

export interface KizReturnsParseResult {
  headerRow: number;
  columns: Partial<Record<"nmId" | "article" | "barcode" | "returnedAt" | "reason" | "code", string>>;
  lines: KizReturnLine[];
  errors: string[];
  warnings: string[];
}

/** Бренд, под которым собираются строки без совпадения в каталоге кабинета. */
export const KIZ_BRAND_UNKNOWN = "Бренд не найден в каталоге";

const SALES_ALIASES = {
  taskId: ["номерзадания", "задание", "идзадания", "rid", "srid", "сборочноезадание", "номерсборочногозадания"],
  nmId: ["артикулwb", "nmid", "номенклатура", "кодwb"],
  article: ["артикулпродавца", "артикул", "vendorcode", "sku"],
  barcode: ["штрихкод", "шк", "баркод", "barcode"],
  soldAt: ["датапродажи", "датазаказа", "дата", "датаотгрузки"],
  code: ["кодмаркировки", "киз", "маркировка", "честныйзнак", "sgtin", "datamatrix", "dm"],
} as const;

const RETURNS_ALIASES = {
  nmId: ["артикулwb", "nmid", "номенклатура", "кодwb"],
  article: ["артикулпродавца", "артикул", "vendorcode", "sku"],
  barcode: ["штрихкод", "шк", "баркод", "barcode"],
  returnedAt: ["датавозврата", "датаприёмки", "датаприемки", "дата"],
  reason: ["причина", "причинавозврата", "типвозврата", "статус"],
  code: ["кодмаркировки", "киз", "маркировка", "честныйзнак", "sgtin", "datamatrix", "dm"],
} as const;

const normalize = (value: unknown) =>
  String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "");
const clean = (value: unknown, max = 255) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

/**
 * Код идентификации из марки: 01<GTIN 14><21><серийник 13> = 31 символ.
 * Всё, что идёт после разделителя GS (\u001d) — криптохвост, он в списки не идёт.
 */
export function parseKizCode(raw: string): KizCode {
  const normalized = clean(raw, 512);
  // Excel часто сохраняет разделитель как видимый маркер <GS> — режем и его.
  const head = normalized.split(/\u001d|\u241d|<GS>/i)[0].trim();
  const looksLikeKm = head.startsWith("01") && head.length >= 31 && /^\d{14}$/.test(head.slice(2, 16));
  if (!looksLikeKm) return { raw: normalized, code: null, gtin: null, serial: null, gtinPrefix: null };
  const code = head.slice(0, 31);
  const gtin = code.slice(2, 16);
  // gtinPrefix — первые 9 знаков GTIN, технический ключ группировки (см. KizCode).
  return { raw: normalized, code, gtin, serial: code.slice(18, 31), gtinPrefix: gtin.slice(1, 10) };
}

/** EAN-8/12/13 → GTIN-14 с ведущими нулями. Не цифры/иная длина → null. */
export function gtinFromBarcode(barcode: string): string | null {
  const digits = clean(barcode, 40).replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits.padStart(14, "0");
}

/** true, если противоречия нет. Неизвестный GTIN — молчим, а не обвиняем. */
export function kizMatchesBarcode(code: KizCode, barcode: string): boolean {
  const fromBarcode = gtinFromBarcode(barcode);
  if (!code.gtin || !fromBarcode) return true;
  return code.gtin === fromBarcode;
}

/** Группа кода: inn/label всегда null — чей это код, из самого кода не следует. */
export function codeGroupRefFromCode(code: KizCode | null): KizCodeGroupRef {
  return { inn: null, label: null, gtinPrefix: code?.gtinPrefix ?? null };
}

/** Дата из ячейки: ISO, ДД.ММ.ГГГГ или серийный номер Excel → YYYY-MM-DD. */
export function parseExportDate(value: unknown): string | null {
  const text = clean(value, 60);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  // Числовые ячейки XLSX приходят серийным номером от 30.12.1899.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 20_000 && serial <= 80_000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

function detect<K extends string>(
  rows: string[][],
  aliases: Record<K, readonly string[]>,
): { row: number; indexes: Partial<Record<K, number>> } {
  let best: { row: number; indexes: Partial<Record<K, number>>; score: number } | null = null;
  for (let row = 0; row < Math.min(30, rows.length); row++) {
    const indexes: Partial<Record<K, number>> = {};
    rows[row].forEach((cell, index) => {
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
  return { row: best.row, indexes: best.indexes };
}

function namedColumns<K extends string>(rows: string[][], row: number, indexes: Partial<Record<K, number>>) {
  const columns: Partial<Record<K, string>> = {};
  for (const [field, index] of Object.entries(indexes) as [K, number][]) columns[field] = clean(rows[row][index], 120);
  return columns;
}

const nmFromCell = (value: string): number | null => {
  const raw = clean(value, 40).replace(/\s/g, "");
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
};

/** Продажи FBS/DBS: единица разбора — проданное сборочное задание с кодом. */
export function parseKizSalesRows(rows: string[][], scheme: KizScheme): KizSalesParseResult {
  const detected = detect(rows, SALES_ALIASES);
  const { indexes } = detected;
  if (indexes.code === undefined) {
    throw new Error("В файле нет колонки кода маркировки — без неё список КИЗ собрать не из чего");
  }
  if (indexes.taskId === undefined) {
    throw new Error("В файле нет колонки номера сборочного задания");
  }
  if (indexes.nmId === undefined && indexes.article === undefined && indexes.barcode === undefined) {
    throw new Error("Нужна хотя бы одна колонка идентификатора: артикул WB, артикул продавца или штрихкод");
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: KizSaleLine[] = [];
  const value = (row: string[], field: keyof typeof SALES_ALIASES) =>
    indexes[field] === undefined ? "" : (row[indexes[field]] ?? "");

  let emptyCodes = 0;
  for (let index = detected.row + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row || row.every((cell) => !clean(cell))) continue;
    const taskId = clean(value(row, "taskId"), 120).toLocaleUpperCase("ru-RU").replace(/\s+/g, "");
    const rawCode = clean(value(row, "code"), 512);
    if (!taskId && !rawCode) continue;
    if (!taskId) {
      if (errors.length < 50) errors.push(`Строка ${index + 1}: нет номера сборочного задания`);
      continue;
    }
    if (!rawCode) emptyCodes += 1;
    lines.push({
      lineNumber: index + 1,
      scheme,
      taskId,
      nmId: nmFromCell(value(row, "nmId")),
      article: clean(value(row, "article"), 255),
      barcode: clean(value(row, "barcode"), 120).replace(/\s/g, ""),
      soldAt: parseExportDate(value(row, "soldAt")),
      code: rawCode ? parseKizCode(rawCode) : null,
    });
  }

  if (!lines.length && !errors.length) errors.push("После строки заголовков нет данных");
  if (emptyCodes) warnings.push(`Строк без кода маркировки: ${emptyCodes} — в списки они не попадут`);
  return { headerRow: detected.row + 1, columns: namedColumns(rows, detected.row, indexes), lines, errors, warnings };
}

/** Возвраты: берём только строки «Возврат брака», как в эталоне. */
export function parseKizReturnsRows(rows: string[][]): KizReturnsParseResult {
  const detected = detect(rows, RETURNS_ALIASES);
  const { indexes } = detected;
  if (indexes.reason === undefined) {
    throw new Error("В файле возвратов нет колонки причины — отобрать «Возврат брака» невозможно");
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: KizReturnLine[] = [];
  const value = (row: string[], field: keyof typeof RETURNS_ALIASES) =>
    indexes[field] === undefined ? "" : (row[indexes[field]] ?? "");

  let skipped = 0;
  for (let index = detected.row + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row || row.every((cell) => !clean(cell))) continue;
    const reason = clean(value(row, "reason"), 255);
    if (!normalize(reason).includes(normalize("возврат брака"))) {
      skipped += 1;
      continue;
    }
    const rawCode = clean(value(row, "code"), 512);
    lines.push({
      lineNumber: index + 1,
      nmId: nmFromCell(value(row, "nmId")),
      article: clean(value(row, "article"), 255),
      barcode: clean(value(row, "barcode"), 120).replace(/\s/g, ""),
      returnedAt: parseExportDate(value(row, "returnedAt")),
      reason,
      code: rawCode ? parseKizCode(rawCode) : null,
    });
  }

  if (!lines.length && !errors.length) errors.push("В файле нет строк с причиной «Возврат брака»");
  if (skipped) warnings.push(`Строк возвратов не по браку пропущено: ${skipped}`);
  return { headerRow: detected.row + 1, columns: namedColumns(rows, detected.row, indexes), lines, errors, warnings };
}

export interface KizBrandListsInput {
  sales: KizSaleLine[];
  returns: KizReturnLine[];
  /** Бренд берётся из каталога кабинета, а не из отчёта WB. */
  brandByNm: Map<number, string>;
  brandByArticle: Map<string, string>;
}

export interface KizBrandListsResult {
  brands: KizBrandExport[];
  totalCodes: number;
  warnings: string[];
}

interface BrandBucket {
  brand: string;
  codes: string[];
  seen: Set<string>;
  duplicatesRemoved: number;
  sources: { fbs: number; dbs: number; returns: number };
  prefixes: Map<string, number>;
}

function resolveBrand(input: KizBrandListsInput, nmId: number | null, article: string): string {
  const byNm = nmId === null ? undefined : input.brandByNm.get(nmId);
  if (byNm) return byNm;
  const byArticle = input.brandByArticle.get(article.trim().toLocaleLowerCase("ru-RU"));
  return byArticle || KIZ_BRAND_UNKNOWN;
}

/** Списки кодов по брендам: дедуп по коду идентификации, группировка — по началу GTIN. */
export function buildKizBrandLists(input: KizBrandListsInput): KizBrandListsResult {
  const buckets = new Map<string, BrandBucket>();
  const globalSeen = new Set<string>();
  const warnings: string[] = [];
  let unrecognized = 0;
  let unknownBrand = 0;

  const push = (source: KizSourceKind, code: KizCode | null, nmId: number | null, article: string) => {
    if (!code?.code) {
      if (code) unrecognized += 1;
      return;
    }
    const brand = resolveBrand(input, nmId, article);
    if (brand === KIZ_BRAND_UNKNOWN) unknownBrand += 1;
    let bucket = buckets.get(brand);
    if (!bucket) {
      bucket = { brand, codes: [], seen: new Set(), duplicatesRemoved: 0, sources: { fbs: 0, dbs: 0, returns: 0 }, prefixes: new Map() };
      buckets.set(brand, bucket);
    }
    if (bucket.seen.has(code.code) || globalSeen.has(code.code)) {
      bucket.duplicatesRemoved += 1;
      return;
    }
    bucket.seen.add(code.code);
    globalSeen.add(code.code);
    bucket.codes.push(code.code);
    bucket.sources[source] += 1;
    if (code.gtinPrefix) bucket.prefixes.set(code.gtinPrefix, (bucket.prefixes.get(code.gtinPrefix) ?? 0) + 1);
  };

  for (const line of input.sales) push(line.scheme === "DBS" ? "dbs" : "fbs", line.code, line.nmId, line.article);
  for (const line of input.returns) push("returns", line.code, line.nmId, line.article);

  if (unrecognized) warnings.push(`Строк с нераспознанным кодом: ${unrecognized} — ожидается код идентификации из 31 символа`);
  if (unknownBrand) warnings.push(`Строк без бренда в каталоге кабинета: ${unknownBrand}`);

  const brands = [...buckets.values()]
    .map((bucket): KizBrandExport => {
      const top = [...bucket.prefixes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return {
        brand: bucket.brand,
        codeGroup: { inn: null, label: null, gtinPrefix: top?.[0] ?? null },
        codes: bucket.codes,
        duplicatesRemoved: bucket.duplicatesRemoved,
        sources: bucket.sources,
      };
    })
    .sort((a, b) => b.codes.length - a.codes.length || a.brand.localeCompare(b.brand, "ru-RU"));

  return { brands, totalCodes: globalSeen.size, warnings };
}
