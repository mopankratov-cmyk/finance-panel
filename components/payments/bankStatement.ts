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
  documentHash: string;
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
  notes?: string[];
}

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

function parseNumber(value: string): number {
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

function isoDate(value: string): string {
  const clean = value.trim();
  const ru = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const serial = Number(clean);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 100_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return "";
}

function cellColumn(reference: string): string {
  return reference.replace(/\d/g, "");
}

function normalizedLabel(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();
}

function valueAfterLabel(grid: string[][], pattern: RegExp) {
  for (const row of grid) {
    const labelIndex = row.findIndex((cell) => pattern.test(normalizedLabel(cell ?? "")));
    if (labelIndex < 0) continue;
    const label = row[labelIndex]?.trim();
    const value = row.slice(labelIndex + 1).find((cell) => {
      const clean = cell?.trim();
      return clean && clean !== label && !/^ооо\s+["«]?вб банк/i.test(clean);
    });
    if (value) return value.trim();
  }
  return "";
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

export async function parseWbBankXlsx(file: File): Promise<BankStatement> {
  const documentHash = await fileSha256(file);
  const grid = await readFirstSheetXlsx(file);
  const metadata = await readXlsxMetadata(file);
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim();
  const aliases = {
    date: ["дата операции", "дата проводки", "дата платежа", "дата документа", "дата"],
    debit: ["списание", "сумма списания", "дебет", "расход"],
    credit: ["зачисление", "сумма зачисления", "кредит", "приход", "поступление"],
    amount: ["сумма операции", "сумма"],
    direction: ["тип операции", "направление", "приход расход", "дебет кредит"],
    document: ["номер документа", "документ", "номер платежа", "id операции"],
    account: ["счет", "номер счета", "расчетный счет", "банковский счет"],
    counterparty: ["контрагент", "наименование контрагента", "получатель", "плательщик"],
    inn: ["инн контрагента", "инн получателя", "инн плательщика", "инн"],
    counterpartyAccount: ["счет контрагента", "счет получателя", "счет плательщика"],
    purpose: ["назначение платежа", "назначение", "описание операции", "основание платежа"],
  } as const;
  const headerIndex = grid.findIndex((row) => {
    const headers = row.map(normalize);
    const hasDate = headers.some((cell) => aliases.date.includes(cell as never));
    const hasMoney = headers.some((cell) => [...aliases.debit, ...aliases.credit, ...aliases.amount].includes(cell as never));
    return hasDate && hasMoney;
  });
  if (headerIndex < 0) {
    const operationCount = parseNumber(valueAfterLabel(grid, /^количество операций/));
    const looksLikeEmptyStatement = grid.some((row) => row.some((cell) => /выписка операций по счету/i.test(cell ?? "")))
      && operationCount === 0;
    if (looksLikeEmptyStatement) {
      const period = valueAfterLabel(grid, /^за период$/).match(/с\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s+по\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
      const owner = grid.flat().find((cell) => /^(?:индивидуальный предприниматель|ип)\s+/i.test(cell?.trim() ?? ""))?.trim() ?? "";
      return {
        documentHash,
        bank: grid[0]?.find((cell) => cell.trim())?.trim() || "Банковская выписка",
        owner,
        ownerInn: valueAfterLabel(grid, /^инн кио$/).replace(/\D/g, ""),
        accountNumber: valueAfterLabel(grid, /^выписка операций по счету$/).replace(/\D/g, ""),
        dateFrom: isoDate(period?.[1] ?? ""),
        dateTo: isoDate(period?.[2] ?? ""),
        openingBalance: parseNumber(valueAfterLabel(grid, /^входящий остаток$/)),
        closingBalance: parseNumber(valueAfterLabel(grid, /^исходящий остаток$/)),
        declaredDebit: parseNumber(valueAfterLabel(grid, /^обороты по дебету$/)),
        declaredCredit: parseNumber(valueAfterLabel(grid, /^обороты по кредиту$/)),
        rows: [],
        warnings: ["Выписка распознана корректно: банк указал 0 операций за выбранный период"],
      };
    }
    throw new Error("Не удалось определить заголовки банковской выписки. Нужны колонки с датой и суммой операции");
  }
  const headers = grid[headerIndex].map(normalize);
  const column = (names: readonly string[], forbidden: string[] = []) => {
    const exact = headers.findIndex((cell) => names.includes(cell));
    if (exact >= 0) return exact;
    return headers.findIndex((cell) => names.some((name) => cell.includes(name)) && !forbidden.some((word) => cell.includes(word)));
  };
  const dateColumn = column(aliases.date);
  const debitColumn = column(aliases.debit);
  const creditColumn = column(aliases.credit);
  const amountColumn = column(aliases.amount);
  const directionColumn = column(aliases.direction);
  const documentColumn = column(aliases.document);
  const accountColumn = column(aliases.account, ["контрагент", "получател", "плательщик", "корр", "банк"]);
  const counterpartyColumn = column(aliases.counterparty);
  const innColumn = column(aliases.inn);
  const counterpartyAccountColumn = column(aliases.counterpartyAccount);
  const purposeColumn = column(aliases.purpose);
  const operations: BankStatementRow[] = [];
  const accountCounts = new Map<string, number>();

  for (let index = headerIndex + 1; index < grid.length; index++) {
    const cells = grid[index];
    const date = isoDate(cells[dateColumn] ?? "");
    if (!date) continue;
    const debit = debitColumn >= 0 ? parseNumber(cells[debitColumn] ?? "") : 0;
    const credit = creditColumn >= 0 ? parseNumber(cells[creditColumn] ?? "") : 0;
    const rawAmount = amountColumn >= 0 ? parseNumber(cells[amountColumn] ?? "") : 0;
    const direction = directionColumn >= 0 ? normalize(cells[directionColumn] ?? "") : "";
    let amount = credit > 0 ? credit : debit > 0 ? -debit : rawAmount;
    if (rawAmount && direction) {
      if (/спис|расход|дебет|выбыт/.test(direction)) amount = -Math.abs(rawAmount);
      if (/зачис|приход|кредит|поступ/.test(direction)) amount = Math.abs(rawAmount);
    }
    if (!amount) continue;
    const documentNumber = documentColumn >= 0 ? cells[documentColumn]?.trim() ?? "" : String(index + 1);
    const account = accountColumn >= 0 ? (cells[accountColumn] ?? "").replace(/\D/g, "") : "";
    if (account.length >= 15) accountCounts.set(account, (accountCounts.get(account) ?? 0) + 1);
    operations.push({
      id: `${documentHash}:${index + 1}`,
      date,
      amount,
      counterparty: counterpartyColumn >= 0 ? cells[counterpartyColumn]?.trim() ?? "" : "",
      counterpartyInn: innColumn >= 0 ? cells[innColumn]?.trim() ?? "" : "",
      counterpartyAccount: counterpartyAccountColumn >= 0 ? cells[counterpartyAccountColumn]?.trim() ?? "" : "",
      purpose: purposeColumn >= 0 ? cells[purposeColumn]?.replace(/\s+/g, " ").trim() ?? "" : "",
      documentNumber,
    });
  }
  const actualDebit = operations.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
  const actualCredit = operations.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const labeledTotal = (patterns: RegExp[]) => {
    for (const row of grid) {
      for (let index = 0; index < row.length; index++) {
        if (!patterns.some((pattern) => pattern.test(normalize(row[index] ?? "")))) continue;
        for (let offset = 1; offset <= 3; offset++) {
          const parsed = parseNumber(row[index + offset] ?? "");
          if (parsed) return parsed;
        }
      }
    }
    return 0;
  };
  const controlDebit = labeledTotal([/итого.*спис/, /оборот.*дебет/, /всего.*расход/]);
  const controlCredit = labeledTotal([/итого.*зачис/, /оборот.*кредит/, /всего.*поступ/]);
  const declaredDebit = controlDebit || actualDebit;
  const declaredCredit = controlCredit || actualCredit;
  const warnings: string[] = [];
  if (!operations.length) warnings.push("В выписке не найдено операций с датой и суммой");
  if (controlDebit && Math.abs(actualDebit - controlDebit) > 0.01) warnings.push("Сумма расходов не совпала с контрольной суммой банка");
  if (controlCredit && Math.abs(actualCredit - controlCredit) > 0.01) warnings.push("Сумма поступлений не совпала с контрольной суммой банка");
  const dates = operations.map((row) => row.date).sort();
  const accountNumber = [...accountCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const owner = metadata.match(/(?:Клиент|Владелец)\s*:?\s*([^<]{3,160}?)(?=\s+ИНН\s*:|\s+Счет\s*:)/i)?.[1]?.trim() ?? "";
  const ownerInn = metadata.match(/ИНН\s*:?\s*(\d{10,12})/i)?.[1] ?? "";
  const bank = /банк точка/i.test(metadata) ? "Банк Точка" : /озон банк|ozon/i.test(metadata) ? "Ozon Банк" : /т[- ]?банк|тинькофф/i.test(metadata) ? "Т-Банк" : "Банковская выписка";
  return {
    documentHash,
    bank,
    owner,
    ownerInn,
    accountNumber,
    dateFrom: dates[0] ?? "",
    dateTo: dates.at(-1) ?? "",
    openingBalance: 0,
    closingBalance: 0,
    declaredDebit,
    declaredCredit,
    rows: operations,
    warnings,
  };
}

export async function parseBankStatement(file: File): Promise<BankStatement> {
  if (file.size > MAX_BANK_FILE_BYTES) throw new Error("Файл выписки больше 20 МБ");
  if (file.name.toLowerCase().endsWith(".xlsx")) return parseWbBankXlsx(file);
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/opiu/bank-statement", { method: "POST", body });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? "Не удалось распознать PDF-выписку");
    return data as BankStatement;
  }
  throw new Error("Поддерживаются банковские выписки XLSX и PDF");
}
