import { sectionForCategory } from "./ddsSummary";
import type { Payment } from "@/lib/types";
import { decodeBankSplits } from "./bankInstructionSplits";
import type { BankReviewItem } from "./bankReviewStore";

type PaymentWithCompany = Payment & { companyId?: string | null };

interface ExportContext {
  payments: PaymentWithCompany[];
  accountNameById: Map<string, string>;
  companyNameById: Map<string, string>;
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function directionForPayment(payment: Payment): string {
  const category = payment.category.toLowerCase();
  if (category.includes("поступ") || category.includes("получение") || category.includes("вклад")) return "Поступление";
  if (category.includes("выбыт") || category.includes("выдача") || category.includes("оплат") || category.includes("дивиденд")) return "Выбытие";
  return payment.amount >= 0 ? "Поступление" : "Выбытие";
}

export function ddsTemplateRows({ payments, accountNameById, companyNameById }: ExportContext): Array<Array<string | number>> {
  const header = [
    "Месяц", "Мсц (цифрой)", "Дата", "Сумма", "Сумма в валюте", "Кошелек",
    "Направление бизнеса", "Контрагент", "Вид выплаты сотруднику", "Назначение платежа",
    "Статья", "Платеж/поступл", "Вид д-ти",
  ];
  const facts = payments.filter((payment) => payment.status === "done").sort((a, b) => a.date.localeCompare(b.date));
  return [header, ...facts.map((payment) => {
    const [year, month, day] = payment.date.split("-");
    const monthNumber = Number(month);
    return [
      MONTHS[monthNumber - 1] ?? "",
      monthNumber,
      `${day}.${month}.${year}`,
      payment.amount,
      "",
      accountNameById.get(payment.accountId) ?? "",
      payment.companyId ? companyNameById.get(payment.companyId) ?? "" : "Общее",
      payment.counterparty,
      "",
      payment.name,
      payment.category,
      directionForPayment(payment),
      `${sectionForCategory(payment.category)}${sectionForCategory(payment.category) === "Техническая" ? " операция" : ""}`,
    ];
  })];
}

export function ddsReviewTemplateRows(
  items: BankReviewItem[],
  accountNameById: Map<string, string>,
  companyNameById: Map<string, string> = new Map(),
) {
  const rows: Array<Array<string | number>> = [];
  const rowIds: string[] = [];
  for (const item of items) {
    const [year, month, day] = item.date.split("-");
    const monthNumber = Number(month);
    const base = (amount: number, purpose: string): Array<string | number> => [
      MONTHS[monthNumber - 1] ?? "", monthNumber, `${day}.${month}.${year}`, amount, "",
      item.accountId ? accountNameById.get(item.accountId) ?? "" : "",
      item.companyId ? companyNameById.get(item.companyId) ?? "" : "", item.counterparty, "", purpose, "", amount >= 0 ? "Поступление" : "Выбытие", "На проверке",
    ];
    const splits = decodeBankSplits(item.managerAnswer);
    const includedSplits = splits?.filter((split) => !split.excluded) ?? [];
    if (includedSplits.length) {
      includedSplits.forEach((split, index) => {
        rows.push(base(item.amount < 0 ? -split.amount : split.amount, split.description));
        rowIds.push(index === 0 ? `bank-review:${item.id}` : `bank-review:${item.id}:split:${index}`);
      });
    } else {
      rows.push(base(item.amount, item.purpose));
      rowIds.push(`bank-review:${item.id}`);
    }
  }
  return { rows, rowIds };
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number): string {
  const text = sanitizeSpreadsheetText(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sanitizeSpreadsheetText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function downloadDdsCsv(context: ExportContext) {
  const csv = "\ufeff" + ddsTemplateRows(context).map((row) => row.map(csvCell).join(",")).join("\r\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `ДДС_факт_${new Date().toISOString().slice(0, 10)}.csv`);
}

const encoder = new TextEncoder();
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true);
    localView.setUint32(14, crc32(file.data), true); localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true); localView.setUint16(26, name.length, true);
    local.push(localHeader, name, file.data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc32(file.data), true); centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true); centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + file.data.length;
  }
  const centralData = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralData.length, true); endView.setUint32(16, offset, true);
  return concat([...local, centralData, end]);
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function columnName(index: number): string {
  let value = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
  return value;
}

export function buildSimpleXlsx(rows: Array<Array<string | number>>, sheetName = "Данные"): Uint8Array {
  return buildMultiSheetXlsx([{ name: sheetName, rows }]);
}

export function buildMultiSheetXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>): Uint8Array {
  const worksheetFiles: Array<{ name: string; data: Uint8Array }> = [];
  const workbookSheets: string[] = [];
  const workbookRelationships: string[] = [];
  const contentTypes: string[] = [];
  sheets.forEach((item, sheetIndex) => {
    const body = item.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return typeof value === "number"
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    }).join("")}</row>`).join("");
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
    const id = sheetIndex + 1;
    worksheetFiles.push({ name: `xl/worksheets/sheet${id}.xml`, data: encoder.encode(sheet) });
    workbookSheets.push(`<sheet name="${escapeXml(item.name.slice(0, 31))}" sheetId="${id}" r:id="rId${id}"/>`);
    workbookRelationships.push(`<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${id}.xml"/>`);
    contentTypes.push(`<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets.join("")}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships.join("")}</Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentTypes.join("")}</Types>`;
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(types) }, { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) }, { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    ...worksheetFiles,
  ]);
}

export function downloadSimpleXlsx(rows: Array<Array<string | number>>, fileName: string, sheetName = "Данные") {
  const bytes = buildSimpleXlsx(rows, sheetName);
  const buffer = bytes.slice().buffer as ArrayBuffer;
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}

export function downloadDdsXlsx(context: ExportContext) {
  const bytes = buildSimpleXlsx(ddsTemplateRows(context), "ДДС месяц");
  const buffer = bytes.slice().buffer as ArrayBuffer;
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `ДДС_факт_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadGroupedDdsXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>) {
  const bytes = buildMultiSheetXlsx(sheets);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `ДДС_по_компаниям_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
