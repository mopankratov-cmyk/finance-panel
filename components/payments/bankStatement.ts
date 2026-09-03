// Типы и разбор сетки живут в lib/finance/bankStatementGrid.ts — их вызывает
// сервер. Здесь остался только браузерный читатель XLSX для импортов календаря
// (массовое добавление, замена части плана); выписки разбирает /api/opiu/bank-statement.
import { statementFromGrid, type BankStatement, type BankStatementRow } from "@/lib/finance/bankStatementGrid";

export type { BankStatement, BankStatementRow };

const decoder = new TextDecoder("utf-8");
const MAX_BANK_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

async function unzipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  if (buffer.byteLength > MAX_BANK_FILE_BYTES) throw new Error("Файл выписки больше 20 МБ");
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Файл XLSX повреждён: не найден ZIP-каталог");

  const count = u16(view, eocd + 10);
  if (count > MAX_ZIP_ENTRIES) throw new Error("В XLSX слишком много внутренних файлов");
  let offset = u32(view, eocd + 16);
  const result = new Map<string, Uint8Array>();
  let totalUncompressed = 0;

  for (let index = 0; index < count; index++) {
    if (offset < 0 || offset + 46 > bytes.length) throw new Error("Файл XLSX повреждён: каталог выходит за границы файла");
    if (u32(view, offset) !== 0x02014b50) throw new Error("Файл XLSX повреждён: неверный ZIP-каталог");
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("В XLSX найден слишком большой внутренний файл");
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error("XLSX имеет подозрительно высокий коэффициент сжатия");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("Распакованный XLSX слишком большой");
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length || localOffset + 30 > bytes.length) {
      throw new Error("Файл XLSX повреждён: неверные смещения ZIP");
    }
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart < 0 || dataStart + compressedSize > bytes.length) throw new Error("Файл XLSX повреждён: неполные данные ZIP");
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`XLSX использует неподдерживаемое ZIP-сжатие: ${method}`);
    if (data.length !== uncompressedSize || data.length > MAX_ENTRY_BYTES) {
      throw new Error("Файл XLSX повреждён: размер распакованных данных не совпадает");
    }
    result.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function xml(bytes: Uint8Array): Document {
  const doc = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Не удалось прочитать XML внутри XLSX");
  return doc;
}



function cellColumn(reference: string): string {
  return reference.replace(/\d/g, "");
}



export async function readFirstSheetXlsx(file: File): Promise<string[][]> {
  const entries = await unzipEntries(await file.arrayBuffer());
  const stringsBytes = entries.get("xl/sharedStrings.xml");
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBytes) throw new Error("В XLSX не найден первый лист");
  const sharedStrings = stringsBytes
    ? [...xml(stringsBytes).getElementsByTagNameNS("*", "si")].map((item) =>
        [...item.getElementsByTagNameNS("*", "t")].map((node) => node.textContent ?? "").join(""),
      )
    : [];
  const sheet = xml(sheetBytes);
  const result: string[][] = [];
  for (const row of sheet.getElementsByTagNameNS("*", "row")) {
    const values = new Map<number, string>();
    let maxColumn = -1;
    for (const cell of row.getElementsByTagNameNS("*", "c")) {
      const reference = cell.getAttribute("r") ?? "";
      const letters = cellColumn(reference);
      let column = 0;
      for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
      column -= 1;
      maxColumn = Math.max(maxColumn, column);
      const raw = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
      const inline = [...cell.getElementsByTagNameNS("*", "t")].map((node) => node.textContent ?? "").join("");
      values.set(column, cell.getAttribute("t") === "s" ? sharedStrings[Number(raw)] ?? "" : inline || raw);
    }
    if (maxColumn >= 0) result.push(Array.from({ length: maxColumn + 1 }, (_, index) => values.get(index) ?? ""));
  }
  return result;
}

async function readXlsxMetadata(file: File): Promise<string> {
  const entries = await unzipEntries(await file.arrayBuffer());
  return [...entries.entries()]
    .filter(([name]) => name === "xl/sharedStrings.xml" || name.startsWith("xl/worksheets/sheet"))
    .map(([, bytes]) => decoder.decode(bytes).replace(/<[^>]+>/g, " "))
    .join(" ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** @deprecated Выписки разбирает сервер (/api/opiu/bank-statement); оставлено для совместимости. */
export async function parseWbBankXlsx(file: File): Promise<BankStatement> {
  const documentHash = await fileSha256(file);
  const grid = await readFirstSheetXlsx(file);
  const metadata = await readXlsxMetadata(file);
  return statementFromGrid(grid, metadata, documentHash);
}

export async function parseBankStatement(file: File): Promise<BankStatement> {
  if (file.size > MAX_BANK_FILE_BYTES) throw new Error("Файл выписки больше 20 МБ");
  if (file.name.toLowerCase().endsWith(".xlsx")) return parseWbBankXlsx(file);
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/opiu/bank-statement", { method: "POST", body });
    const data = await response.json().catch(() => null) as { statement?: BankStatement; error?: string } | null;
    if (!response.ok || !data?.statement) throw new Error(data?.error ?? "Не удалось распознать PDF-выписку");
    return data.statement;
  }
  throw new Error("Поддерживаются банковские выписки XLSX и PDF");
}
