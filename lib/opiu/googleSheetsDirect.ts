import { getDriveToken } from "@/lib/google/drive";
import { resolveLoanBlock, resolveRegisterRow } from "@/lib/opiu/googleSheetIdentity";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_FINANCE_SPREADSHEET_ID = "1NN9AIN0VA7OjE4bErihq2cHFhGZsOinVbbTupNdvfvY";

export interface DirectSheetJob {
  sheet: string;
  template: string;
  rows: Array<Array<string | number>>;
  rowIds?: string[];
}

type SheetProperties = { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } };

const aliases: Record<string, string[]> = {
  "План выбытий": ["План выбытий РИО", "План выбытий группы"],
  "ДДС месяц": ["ДДС_ месяц", "ДДС месяц"],
  "Учёт кредитов займов от сторонн": ["Учёт кредитов займов от сторонн", "Учёт кредитов займов от сторонних", "Учет кредитов займов от сторонн"],
};

const formulaColumnsFor = (name: string) => {
  if (/ДДС.*месяц/i.test(name)) return ["Месяц", "Мсц (цифрой)", "Платеж/поступл", "Вид д-ти"];
  if (name === "Плановый Реестр поступлений") return ["Год план", "Месяц план", "Номер недели план"];
  if (name.startsWith("План выбытий")) return ["Номер недели", "Начало недели", "Конец недели", "Год план", "Месяц план"];
  if (name === "Факт ДДС") return ["Год", "Месяц", "День недели", "Платеж/поступл"];
  return [];
};

const keyColumnsFor = (name: string) => {
  if (/ДДС.*месяц/i.test(name)) return ["Дата", "Сумма", "Кошелек", "Контрагент", "Назначение платежа"];
  if (name === "Плановый Реестр поступлений") return ["Дата планируемого получения", "Сумма план", "Контрагент", "Статья поступлений"];
  if (name.startsWith("План выбытий")) return ["Дата планируемой оплаты", "Сумма план", "Статья", "Контрагент", "Комментарий"];
  if (name === "Факт ДДС") return ["Дата", "Сумма", "Контрагент", "Назначение платежа", "Статья"];
  return [];
};

const columnName = (index: number) => {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
const normalizedKeyPart = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

async function googleRequest<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) {
    if (response.status === 403) {
      let serviceAccount = "finance-panel-drive@iconic-glass-459417-i7.iam.gserviceaccount.com";
      try {
        const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64 ?? "", "base64").toString("utf8")) as { client_email?: string };
        if (credentials.client_email) serviceAccount = credentials.client_email;
      } catch { /* Показываем известный адрес текущего финансового service account. */ }
      throw new Error(`У Google Таблицы нет права на запись. Выдайте роль «Редактор» адресу ${serviceAccount}`);
    }
    throw new Error(payload?.error?.message || `Google Sheets API вернул ${response.status}`);
  }
  return payload as T;
}

async function readValues(token: string, spreadsheetId: string, sheet: string, range: string, formulas = false) {
  const target = encodeURIComponent(`${quoteSheet(sheet)}!${range}`);
  const render = formulas ? "FORMULA" : "UNFORMATTED_VALUE";
  const result = await googleRequest<{ values?: unknown[][] }>(token, `${SHEETS_API}/${spreadsheetId}/values/${target}?valueRenderOption=${render}`);
  return result.values ?? [];
}

async function batchUpdate(token: string, spreadsheetId: string, requests: unknown[]) {
  if (!requests.length) return;
  await googleRequest(token, `${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

async function writeValues(token: string, spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>) {
  if (!data.length) return;
  await googleRequest(token, `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
}

function findSheet(requested: string, sheets: SheetProperties[]) {
  return sheets.find((sheet) => sheet.title === requested)
    ?? sheets.find((sheet) => (aliases[requested] ?? []).includes(sheet.title));
}

function findHeader(values: unknown[][], incomingHeader: string[], formulaColumns: string[]) {
  const required = incomingHeader.filter((name) => name && !formulaColumns.includes(name));
  for (let row = 0; row < Math.min(12, values.length); row += 1) {
    const normalized = (values[row] ?? []).map((value) => String(value ?? "").trim());
    const matches = required.filter((name) => normalized.includes(name)).length;
    if (matches >= Math.min(4, required.length)) return { row, values: normalized };
  }
  return null;
}

function makeKey(row: unknown[], index: Map<string, number>, names: string[]) {
  const values = names.map((name) => normalizedKeyPart(row[index.get(name) ?? -1]));
  return values.every(Boolean) ? values.join("|") : "";
}

async function syncRegister(
  token: string,
  spreadsheetId: string,
  sheet: SheetProperties,
  rows: DirectSheetJob["rows"],
  rowIds: string[] = [],
) {
  const existing = await readValues(token, spreadsheetId, sheet.title, "A1:AZ10000");
  const incomingHeader = rows[0].map(String);
  const formulaColumns = formulaColumnsFor(sheet.title);
  const header = findHeader(existing, incomingHeader, formulaColumns);
  if (!header) throw new Error(`На листе «${sheet.title}» не найдена строка с нужными заголовками`);
  const metaHeader = "__finance_id";
  const rawWidth = Math.max(1, header.values.findLastIndex((value) => value !== "") + 1);
  const existingIdColumn = header.values.indexOf(metaHeader);
  const width = existingIdColumn >= 0 ? existingIdColumn : rawWidth;
  const idColumn = existingIdColumn >= 0 ? existingIdColumn : width;
  const targetHeader = header.values.slice(0, width);
  const targetIndex = new Map(targetHeader.map((name, index) => [name, index]));
  const incomingIndex = new Map(incomingHeader.map((name, index) => [name, index]));
  const keyNames = keyColumnsFor(sheet.title);
  if (!keyNames.length) throw new Error(`Для листа «${sheet.title}» не настроена защита от дублей`);
  const dataStart = header.row + 1;
  let lastDataIndex = existing.length - 1;
  const firstKeyIndex = targetIndex.get(keyNames[0]) ?? 0;
  while (lastDataIndex >= dataStart && !normalizedKeyPart(existing[lastDataIndex]?.[firstKeyIndex])) lastDataIndex -= 1;
  const legacyRows = new Map<string, number[]>();
  const rowsById = new Map<string, number>();
  for (let rowIndex = dataStart; rowIndex <= lastDataIndex; rowIndex += 1) {
    const key = makeKey(existing[rowIndex] ?? [], targetIndex, keyNames);
    if (key) legacyRows.set(key, [...(legacyRows.get(key) ?? []), rowIndex]);
    const id = normalizedKeyPart(existing[rowIndex]?.[idColumn]);
    if (id) rowsById.set(id, rowIndex);
  }
  const additions: Array<{ row: unknown[]; id: string }> = [];
  const replacements = new Map<number, { row: unknown[]; id: string }>();
  let skipped = 0;
  for (const [offset, incoming] of rows.slice(1).entries()) {
    const candidate = targetHeader.map((name) => incoming[incomingIndex.get(name) ?? -1] ?? "");
    const key = makeKey(candidate, targetIndex, keyNames);
    const id = String(rowIds[offset] ?? "").trim();
    const targetRow = resolveRegisterRow(id, key, rowsById, legacyRows);
    if (targetRow != null) {
      replacements.set(targetRow, { row: candidate, id });
      if (id) rowsById.set(normalizedKeyPart(id), targetRow);
      continue;
    }
    if (!id && !key) { skipped += 1; continue; }
    additions.push({ row: candidate, id });
  }
  const startRow = Math.max(dataStart, lastDataIndex + 1);
  const sourceRow = Math.max(dataStart, lastDataIndex);
  const neededRows = startRow + additions.length;
  const rowCount = sheet.gridProperties?.rowCount ?? 0;
  const columnCount = sheet.gridProperties?.columnCount ?? 0;
  const requests: unknown[] = [];
  if (neededRows > rowCount) {
    requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: "ROWS", length: neededRows - rowCount } });
  }
  if (idColumn >= columnCount) {
    requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: "COLUMNS", length: idColumn - columnCount + 1 } });
  }
  if (additions.length) requests.push({
    copyPaste: {
      source: { sheetId: sheet.sheetId, startRowIndex: sourceRow, endRowIndex: sourceRow + 1, startColumnIndex: 0, endColumnIndex: width },
      destination: { sheetId: sheet.sheetId, startRowIndex: startRow, endRowIndex: startRow + additions.length, startColumnIndex: 0, endColumnIndex: width },
      pasteType: "PASTE_NORMAL",
      pasteOrientation: "NORMAL",
    },
  });
  requests.push({ updateDimensionProperties: {
    range: { sheetId: sheet.sheetId, dimension: "COLUMNS", startIndex: idColumn, endIndex: idColumn + 1 },
    properties: { hiddenByUser: true }, fields: "hiddenByUser",
  } });
  await batchUpdate(token, spreadsheetId, requests);
  const writes: Array<{ range: string; values: unknown[][] }> = [{
    range: `${quoteSheet(sheet.title)}!${columnName(idColumn)}${header.row + 1}`,
    values: [[metaHeader]],
  }];
  if (replacements.size) {
    const indices = [...replacements.keys()].sort((a, b) => a - b);
    const first = indices[0];
    const last = indices.at(-1)!;
    writes.push(...targetHeader.flatMap((name, column) => formulaColumns.includes(name) ? [] : [{
      range: `${quoteSheet(sheet.title)}!${columnName(column)}${first + 1}:${columnName(column)}${last + 1}`,
      values: Array.from({ length: last - first + 1 }, (_, offset) => [replacements.get(first + offset)?.row[column] ?? existing[first + offset]?.[column] ?? ""]),
    }]));
    writes.push({
      range: `${quoteSheet(sheet.title)}!${columnName(idColumn)}${first + 1}:${columnName(idColumn)}${last + 1}`,
      values: Array.from({ length: last - first + 1 }, (_, offset) => [replacements.get(first + offset)?.id || existing[first + offset]?.[idColumn] || ""]),
    });
  }
  if (additions.length) writes.push(...targetHeader.flatMap((name, column) => formulaColumns.includes(name) ? [] : [{
    range: `${quoteSheet(sheet.title)}!${columnName(column)}${startRow + 1}:${columnName(column)}${startRow + additions.length}`,
    values: additions.map((item) => [item.row[column] ?? ""]),
  }]));
  if (additions.length) writes.push({
    range: `${quoteSheet(sheet.title)}!${columnName(idColumn)}${startRow + 1}:${columnName(idColumn)}${startRow + additions.length}`,
    values: additions.map((item) => [item.id]),
  });
  await writeValues(token, spreadsheetId, writes);
  return { appended: additions.length, updated: replacements.size, skipped, sheet: sheet.title };
}

async function syncLoans(token: string, spreadsheetId: string, sheet: SheetProperties, rows: DirectSheetJob["rows"], rowIds: string[] = []) {
  const values = await readValues(token, spreadsheetId, sheet.title, "A1:AZ10000", true);
  const header = rows[0].map(String);
  const index = new Map(header.map((name, column) => [name, column]));
  const grouped = new Map<string, {
    company: string;
    creditor: string;
    contract: string;
    loanId: string;
    schedule: Array<Array<string | number>>;
  }>();
  for (const [offset, row] of rows.slice(1).entries()) {
    const company = String(row[index.get("Компания") ?? -1] ?? "").trim();
    const creditor = String(row[index.get("Кредитор") ?? -1] ?? "").trim();
    const contract = String(row[index.get("Договор") ?? -1] ?? "").trim();
    const loanId = String(rowIds[offset] ?? "").trim();
    const key = loanId ? `id:${loanId}` : [company, creditor, contract].map(normalizedKeyPart).join("|");
    const group = grouped.get(key) ?? { company, creditor, contract, loanId, schedule: [] };
    group.schedule.push(row);
    grouped.set(key, group);
  }
  const labels = values.map((row) => String(row[1] ?? ""));
  let templateRow = -1;
  for (let row = 8; row <= labels.length - 9; row += 1) {
    if (/остаток на начало/i.test(labels[row + 1]) && /выплата тела/i.test(labels[row + 2]) && /остаток на конец/i.test(labels[row + 3]) && /начислено процентов/i.test(labels[row + 5])) {
      templateRow = row;
      break;
    }
  }
  if (templateRow < 0) throw new Error("На листе кредитов не найден оформленный блок-шаблон");
  const metaHeader = "__finance_loan_id";
  const existingIdColumn = (values[0] ?? []).findIndex((value) => String(value ?? "").trim() === metaHeader);
  const idColumn = existingIdColumn >= 0 ? existingIdColumn : Math.max(52, ...values.map((row) => row.length));
  const setupRequests: unknown[] = [];
  const columnCount = sheet.gridProperties?.columnCount ?? 0;
  if (idColumn >= columnCount) setupRequests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: "COLUMNS", length: idColumn - columnCount + 1 } });
  setupRequests.push({ updateDimensionProperties: {
    range: { sheetId: sheet.sheetId, dimension: "COLUMNS", startIndex: idColumn, endIndex: idColumn + 1 },
    properties: { hiddenByUser: true }, fields: "hiddenByUser",
  } });
  await batchUpdate(token, spreadsheetId, setupRequests);
  await writeValues(token, spreadsheetId, [{ range: `${quoteSheet(sheet.title)}!${columnName(idColumn)}1`, values: [[metaHeader]] }]);
  let lastRow = values.length;
  while (lastRow > 0 && !(values[lastRow - 1] ?? []).some((value) => normalizedKeyPart(value))) lastRow -= 1;
  let appended = 0;
  let updated = 0;
  let skipped = 0;
  const usedBlocks = new Set<number>();
  for (const group of grouped.values()) {
    const { company, creditor, contract, loanId, schedule } = group;
    const sorted = schedule.slice().sort((left, right) => String(left[index.get("Дата платежа") ?? -1]).localeCompare(String(right[index.get("Дата платежа") ?? -1])));
    const firstScheduleDate = String(sorted[0]?.[index.get("Дата платежа") ?? -1] ?? "").trim();
    const existingBlock = resolveLoanBlock(values, idColumn, { loanId, company, creditor, contract, firstScheduleDate });
    if (existingBlock >= 0 && usedBlocks.has(existingBlock)) { skipped += schedule.length; continue; }
    const replacing = existingBlock >= 0;
    const startRow = replacing ? existingBlock : Math.max(8, lastRow + 1);
    usedBlocks.add(startRow);
    const rowCount = sheet.gridProperties?.rowCount ?? 0;
    const requests: unknown[] = [];
    if (startRow + 9 > rowCount) requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: "ROWS", length: startRow + 9 - rowCount } });
    if (!replacing) requests.push({ copyPaste: {
      source: { sheetId: sheet.sheetId, startRowIndex: templateRow, endRowIndex: templateRow + 9, startColumnIndex: 0, endColumnIndex: Math.max(52, sheet.gridProperties?.columnCount ?? 52) },
      destination: { sheetId: sheet.sheetId, startRowIndex: startRow, endRowIndex: startRow + 9, startColumnIndex: 0, endColumnIndex: Math.max(52, sheet.gridProperties?.columnCount ?? 52) },
      pasteType: "PASTE_NORMAL", pasteOrientation: "NORMAL",
    } });
    await batchUpdate(token, spreadsheetId, requests);
    const first = sorted[0];
    const updates: Array<{ range: string; values: unknown[][] }> = [{
      range: `${quoteSheet(sheet.title)}!A${startRow + 1}:B${startRow + 9}`,
      values: [
        ["Дата получения", creditor || "Кредит без названия"],
        [String(first[index.get("Дата платежа") ?? -1] ?? ""), "Остаток на начало"],
        [company, "Выплата тела кредита"], [contract, "Остаток на конец"], ["", ""],
        ["", "Начислено процентов"], ["", "Задолженность прошлого месяца"],
        ["", "Выплачено процентов"], ["", "Осталось выплатить %"],
      ],
    }, { range: `${quoteSheet(sheet.title)}!${columnName(idColumn)}${startRow + 1}`, values: [[loanId]] }];
    const monthColumns = new Map<string, number>();
    let year = "";
    for (let column = 2; column < Math.max(values[6]?.length ?? 0, values[7]?.length ?? 0); column += 1) {
      if (/^\d{4}$/.test(String(values[6]?.[column] ?? "").trim())) year = String(values[6][column]).trim();
      const month = Number(values[7]?.[column]);
      if (year && month >= 1 && month <= 12) monthColumns.set(`${year}-${String(month).padStart(2, "0")}`, column);
    }
    const byMonth = new Map<string, { principal: number; interest: number; paidInterest: number }>();
    for (const row of sorted) {
      const month = String(row[index.get("Дата платежа") ?? -1] ?? "").slice(0, 7);
      const current = byMonth.get(month) ?? { principal: 0, interest: 0, paidInterest: 0 };
      current.principal += Number(row[index.get("Тело") ?? -1]) || 0;
      current.interest += Number(row[index.get("Проценты") ?? -1]) || 0;
      if (String(row[index.get("Статус") ?? -1]) === "Оплачено") current.paidInterest += Number(row[index.get("Проценты") ?? -1]) || 0;
      byMonth.set(month, current);
    }
    let balance = (Number(first[index.get("Остаток тела") ?? -1]) || 0) + (Number(first[index.get("Тело") ?? -1]) || 0);
    for (const [month, column] of [...monthColumns.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      const item = byMonth.get(month) ?? { principal: 0, interest: 0, paidInterest: 0 };
      const nextBalance = Math.max(0, balance - item.principal);
      updates.push({ range: `${quoteSheet(sheet.title)}!${columnName(column)}${startRow + 2}:${columnName(column)}${startRow + 9}`, values: [
        [balance], [-item.principal], [nextBalance], [""], [item.interest], [0], [-item.paidInterest], [item.interest - item.paidInterest],
      ] });
      balance = nextBalance;
    }
    const summaryRows = [[2, startRow + 6], [3, startRow + 8], [4, startRow + 3], [5, startRow + 9], [6, startRow + 4]];
    for (let column = 2; column < Math.max(values[6]?.length ?? 0, values[7]?.length ?? 0); column += 1) {
      for (const [summaryRow, blockRow] of summaryRows) {
        const formula = String(values[summaryRow - 1]?.[column] ?? "");
        if (!formula.startsWith("=")) continue;
        const reference = `${columnName(column)}${blockRow}`;
        if (!formula.includes(reference)) updates.push({
          range: `${quoteSheet(sheet.title)}!${columnName(column)}${summaryRow}`,
          values: [[`${formula}+${reference}`]],
        });
      }
    }
    await writeValues(token, spreadsheetId, updates);
    if (replacing) updated += schedule.length;
    else {
      appended += schedule.length;
      lastRow = startRow + 9;
    }
  }
  return { appended, updated, skipped, sheet: sheet.title };
}

export async function syncFinanceSheetsDirect(jobs: DirectSheetJob[]) {
  const token = await getDriveToken();
  if (!token) throw new Error("Подключённый Google service account не смог получить токен");
  const spreadsheetId = process.env.FINANCE_SPREADSHEET_ID || DEFAULT_FINANCE_SPREADSHEET_ID;
  const metadata = await googleRequest<{ spreadsheetUrl?: string; sheets?: Array<{ properties?: SheetProperties }> }>(
    token,
    `${SHEETS_API}/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties`,
  );
  const sheets = (metadata.sheets ?? []).flatMap((item) => item.properties ? [item.properties] : []);
  const results = [];
  for (const job of jobs) {
    const sheet = findSheet(job.sheet, sheets);
    if (!sheet) throw new Error(`В Google Таблице не найден лист «${job.sheet}»`);
    results.push(job.template === "loans"
      ? await syncLoans(token, spreadsheetId, sheet, job.rows, job.rowIds)
      : await syncRegister(token, spreadsheetId, sheet, job.rows, job.rowIds));
  }
  return {
    ok: true,
    appended: results.reduce((sum, result) => sum + result.appended, 0),
    updated: results.reduce((sum, result) => sum + result.updated, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    sheets: results,
    spreadsheetUrl: metadata.spreadsheetUrl,
  };
}
