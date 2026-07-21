export interface BankStatementRow {
  id: string;
  date: string;
  amount: number;
  counterparty: string;
  counterpartyInn: string;
  counterpartyAccount: string;
  purpose: string;
  documentNumber: string;
}

export interface BankStatement {
  bank: string;
  owner: string;
  ownerInn: string;
  accountNumber: string;
  dateFrom: string;
  dateTo: string;
  openingBalance: number;
  closingBalance: number;
  declaredDebit: number;
  declaredCredit: number;
  rows: BankStatementRow[];
  warnings: string[];
}

const decoder = new TextDecoder("utf-8");

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

async function unzipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
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
  let offset = u32(view, eocd + 16);
  const result = new Map<string, Uint8Array>();

  for (let index = 0; index < count; index++) {
    if (u32(view, offset) !== 0x02014b50) throw new Error("Файл XLSX повреждён: неверный ZIP-каталог");
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`XLSX использует неподдерживаемое ZIP-сжатие: ${method}`);
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

function parseNumber(value: string): number {
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

function isoDate(value: string): string {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
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

export async function parseWbBankXlsx(file: File): Promise<BankStatement> {
  const entries = await unzipEntries(await file.arrayBuffer());
  const stringsBytes = entries.get("xl/sharedStrings.xml");
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml");
  if (!stringsBytes || !sheetBytes) throw new Error("В XLSX не найден лист банковской выписки");

  const stringsDoc = xml(stringsBytes);
  const sharedStrings = [...stringsDoc.getElementsByTagNameNS("*", "si")].map((item) =>
    [...item.getElementsByTagNameNS("*", "t")].map((node) => node.textContent ?? "").join(""),
  );
  const sheet = xml(sheetBytes);
  const rows = new Map<number, Map<string, string>>();

  for (const row of sheet.getElementsByTagNameNS("*", "row")) {
    const rowNumber = Number(row.getAttribute("r"));
    const values = new Map<string, string>();
    for (const cell of row.getElementsByTagNameNS("*", "c")) {
      const reference = cell.getAttribute("r") ?? "";
      const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
      values.set(cellColumn(reference), cell.getAttribute("t") === "s" ? sharedStrings[Number(value)] ?? "" : value);
    }
    rows.set(rowNumber, values);
  }

  const value = (row: number, column: string) => rows.get(row)?.get(column)?.trim() ?? "";
  const period = value(7, "D").match(/с\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/i);
  const operations: BankStatementRow[] = [];

  for (const [rowNumber, cells] of rows) {
    if (rowNumber < 19) continue;
    const date = isoDate(cells.get("A") ?? "");
    if (!date) continue;
    const debit = parseNumber(cells.get("N") ?? "");
    const credit = parseNumber(cells.get("O") ?? "");
    if (!debit && !credit) continue;
    const documentNumber = cells.get("D")?.trim() ?? "";
    operations.push({
      id: `${date}|${documentNumber}|${debit}|${credit}|${cells.get("M") ?? ""}`,
      date,
      amount: credit > 0 ? credit : -debit,
      counterparty: cells.get("I")?.trim() ?? "",
      counterpartyInn: cells.get("K")?.trim() ?? "",
      counterpartyAccount: cells.get("M")?.trim() ?? "",
      purpose: cells.get("P")?.replace(/\s+/g, " ").trim() ?? "",
      documentNumber,
    });
  }

  const declaredDebit = parseNumber(value(14, "D"));
  const declaredCredit = parseNumber(value(15, "D"));
  const actualDebit = operations.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const actualCredit = operations.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const warnings: string[] = [];
  if (Math.abs(actualDebit - declaredDebit) > 0.01) warnings.push("Сумма расходов не совпала с контрольной суммой банка");
  if (Math.abs(actualCredit - declaredCredit) > 0.01) warnings.push("Сумма поступлений не совпала с контрольной суммой банка");

  return {
    bank: value(1, "A"),
    owner: value(9, "A"),
    ownerInn: value(10, "D"),
    accountNumber: value(5, "D"),
    dateFrom: period ? isoDate(period[1]) : "",
    dateTo: period ? isoDate(period[2]) : "",
    openingBalance: parseNumber(value(12, "D")),
    closingBalance: parseNumber(value(13, "D")),
    declaredDebit,
    declaredCredit,
    rows: operations,
    warnings,
  };
}

export async function parseBankStatement(file: File): Promise<BankStatement> {
  if (file.name.toLowerCase().endsWith(".xlsx")) return parseWbBankXlsx(file);
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/finance/bank-statement", { method: "POST", body });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? "Не удалось распознать PDF-выписку");
    return data as BankStatement;
  }
  throw new Error("Поддерживаются банковские выписки XLSX и PDF");
}
