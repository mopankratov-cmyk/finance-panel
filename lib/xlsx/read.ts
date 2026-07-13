import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const MAX_ROWS = 20_001;
const MAX_COLUMNS = 256;

function xml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi, (_, hex, dec, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    return named === "amp" ? "&" : named === "lt" ? "<" : named === "gt" ? ">" : named === "quot" ? "\"" : "'";
  });
}

function textNodes(value: string): string {
  return [...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => xml(match[1])).join("");
}

function findEocd(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= floor; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Файл не похож на XLSX: не найден конец ZIP-архива");
}

function unzip(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error("XLSX больше 8 МБ");
  const eocd = findEocd(buffer);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries > 2_000 || centralOffset + centralSize > buffer.length) throw new Error("Повреждённый ZIP-каталог XLSX");

  const files = new Map<string, Buffer>();
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Повреждённая запись ZIP-каталога XLSX");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/^\/+/, "");
    offset += 46 + nameLength + extraLength + commentLength;

    if ((flags & 1) !== 0) throw new Error("Зашифрованные XLSX не поддерживаются");
    if (method !== 0 && method !== 8) throw new Error(`Сжатие ZIP ${method} не поддерживается`);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("В XLSX найдена слишком большая XML-часть");
    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw new Error("Распакованный XLSX слишком большой");
    if (!name || name.includes("..") || localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("Повреждённый путь внутри XLSX");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buffer.length) throw new Error("Обрезанная XML-часть XLSX");
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    if (uncompressedSize !== data.length) throw new Error("Размер XML-части XLSX не совпадает с ZIP-каталогом");
    files.set(name, data);
  }
  return files;
}

function firstSheet(files: Map<string, Buffer>): Buffer {
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relationships = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationshipId = workbook.match(/<sheet\b[^>]*\br:id=["']([^"']+)["']/i)?.[1];
  if (relationshipId) {
    for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
      const attrs = match[1];
      const id = attrs.match(/\bId=["']([^"']+)["']/i)?.[1];
      const target = attrs.match(/\bTarget=["']([^"']+)["']/i)?.[1]?.replace(/^\/+/, "").replace(/^\.\//, "");
      if (id !== relationshipId || !target || target.includes("..")) continue;
      const sheet = files.get(target.startsWith("xl/") ? target : `xl/${target}`);
      if (sheet) return sheet;
    }
  }
  const fallback = [...files.entries()].filter(([name]) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name)).sort(([a], [b]) => a.localeCompare(b))[0]?.[1];
  if (!fallback) throw new Error("В XLSX не найден рабочий лист");
  return fallback;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

export function readXlsxRows(buffer: Buffer): string[][] {
  const files = unzip(buffer);
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) => textNodes(match[1]));
  const sheet = firstSheet(files).toString("utf8");
  const rows: string[][] = [];

  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    if (rows.length >= MAX_ROWS) throw new Error("В XLSX больше 20 000 строк");
    const row: string[] = [];
    let sequentialColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attrs.match(/\br=["']([^"']+)["']/i)?.[1];
      const index = reference ? columnIndex(reference) : sequentialColumn;
      sequentialColumn = index + 1;
      if (index < 0 || index >= MAX_COLUMNS) throw new Error("В XLSX больше 256 столбцов");
      const type = attrs.match(/\bt=["']([^"']+)["']/i)?.[1] ?? "n";
      const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "";
      row[index] = type === "inlineStr" ? textNodes(body) : type === "s" ? (shared[Number(raw)] ?? "") : xml(raw);
    }
    while (row.length && row[row.length - 1] === undefined) row.pop();
    rows.push(row.map((cell) => cell ?? ""));
  }
  if (!rows.length) throw new Error("Первый лист XLSX пуст");
  return rows;
}
