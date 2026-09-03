// Чтение первого листа XLSX на сервере — без DOMParser и браузерных потоков.
// Раньше выписки и графики разбирались в браузере (`readFirstSheetXlsx`),
// а значит зависели от того, у кого какой браузер и что успело загрузиться.
// Первый лист берётся по workbook.xml, а не по имени файла `sheet1.xml`:
// у некоторых банков первый по порядку лист лежит в sheet2.xml.

import { inflateRawSync } from "node:zlib";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

export function unzipXlsx(buffer: Buffer): Map<string, Buffer> {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("Файл больше 20 МБ");
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Файл XLSX повреждён: не найден ZIP-каталог");
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > MAX_ZIP_ENTRIES) throw new Error("В XLSX слишком много внутренних файлов");
  let offset = buffer.readUInt32LE(eocd + 16);
  const result = new Map<string, Buffer>();
  let totalUncompressed = 0;
  for (let index = 0; index < count; index++) {
    if (offset < 0 || offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Файл XLSX повреждён: неверный ZIP-каталог");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("В XLSX найден слишком большой внутренний файл");
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error("XLSX имеет подозрительно высокий коэффициент сжатия");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("Распакованный XLSX слишком большой");
    if (offset + 46 + nameLength + extraLength + commentLength > buffer.length || localOffset + 30 > buffer.length) {
      throw new Error("Файл XLSX повреждён: неверные смещения ZIP");
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw new Error("Файл XLSX повреждён: неполные данные ZIP");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`XLSX использует неподдерживаемое ZIP-сжатие: ${method}`);
    if (data.length !== uncompressedSize) throw new Error("Файл XLSX повреждён: размер распакованных данных не совпадает");
    result.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
}

function sharedStrings(entries: Map<string, Buffer>): string[] {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textNodes(match[1]));
}

/** Путь первого листа по порядку в workbook.xml; если книга неполная — sheet1.xml. */
export function firstSheetPath(entries: Map<string, Buffer>): string {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const firstSheet = workbook.match(/<sheet\b[^>]*>/)?.[0] ?? "";
  const relId = firstSheet.match(/\br:id="([^"]+)"/)?.[1] ?? firstSheet.match(/\bid="([^"]+)"/)?.[1];
  if (relId) {
    const relationship = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => match[0])
      .find((tag) => new RegExp(`\\bId="${relId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(tag));
    const target = relationship?.match(/\bTarget="([^"]+)"/)?.[1];
    if (target) {
      const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      if (entries.has(normalized)) return normalized;
    }
  }
  return "xl/worksheets/sheet1.xml";
}

function columnIndex(reference: string): number {
  let column = 0;
  for (const letter of reference.replace(/\d/g, "")) column = column * 26 + letter.charCodeAt(0) - 64;
  return column - 1;
}

export function xlsxGridFromEntries(entries: Map<string, Buffer>): string[][] {
  const sheetXml = entries.get(firstSheetPath(entries))?.toString("utf8");
  if (!sheetXml) throw new Error("В XLSX не найден первый лист");
  const strings = sharedStrings(entries);
  const grid: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const values = new Map<number, string>();
    let maxColumn = -1;
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const reference = attributes.match(/\br="([A-Z]+)\d*"/)?.[1] ?? "";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const body = cell[2] ?? "";
      const column = reference ? columnIndex(reference) : maxColumn + 1;
      maxColumn = Math.max(maxColumn, column);
      const raw = decodeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "");
      const value = type === "s" ? strings[Number(raw)] ?? "" : type === "inlineStr" ? textNodes(body) : raw;
      values.set(column, value);
    }
    if (maxColumn >= 0) grid.push(Array.from({ length: maxColumn + 1 }, (_, index) => values.get(index) ?? ""));
  }
  return grid;
}

/** Первый лист книги как таблица строк. */
export function xlsxGrid(buffer: Buffer): string[][] {
  return xlsxGridFromEntries(unzipXlsx(buffer));
}

/** Весь текст книги (общие строки и листы) — для регулярок по владельцу/ИНН в шапке. */
export function xlsxText(buffer: Buffer): string {
  const entries = unzipXlsx(buffer);
  return [...entries.entries()]
    .filter(([name]) => name === "xl/sharedStrings.xml" || name.startsWith("xl/worksheets/sheet"))
    .map(([, bytes]) => decodeXml(bytes.toString("utf8").replace(/<[^>]+>/g, " ")))
    .join(" ")
    .replace(/\s+/g, " ");
}
