import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const BASE = "https://documents-api.wildberries.ru/api/v1/documents";
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export interface WbDocumentListItem {
  serviceName: string;
  name: string;
  category: string;
  extensions: string[];
  creationTime: string;
}

export interface ParsedWbTaxDocument {
  documentNumber: string;
  documentDate: string;
  grossAmount: number;
  vatAmount: number;
  vatRate: number | null;
  sellerInn: string | null;
  buyerInn: string | null;
}

export class WbDocumentsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function money(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function block(xml: string, name: string): string {
  return xml.match(new RegExp(`<(?:(?:[\\w-]+):)?${name}(?=\\s|>)[^>]*>[\\s\\S]*?<\\/(?:(?:[\\w-]+):)?${name}>`, "i"))?.[0] ?? "";
}

function openingTag(xml: string, name: string): string {
  return xml.match(new RegExp(`<(?:(?:[\\w-]+):)?${name}(?=\\s|/?>)[^>]*>`, "i"))?.[0] ?? "";
}

function partyInn(xml: string, party: "СвПрод" | "СвПокуп"): string | null {
  const value = block(xml, party).match(/(?:^|\s)ИНН(?:ЮЛ|ФЛ)="(\d{10,12})"/i)?.[1];
  return value ?? null;
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const ru = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function parseWbUpdXml(xml: string): ParsedWbTaxDocument | null {
  const invoice = openingTag(xml, "СвСчФакт");
  const totalBlock = block(xml, "ВсегоОпл");
  const totalTag = openingTag(xml, "ВсегоОпл");
  if (!invoice || !totalTag) return null;
  const documentDate = isoDate(attribute(invoice, "ДатаСчФ"));
  const documentNumber = attribute(invoice, "НомерСчФ")?.trim() ?? "";
  const grossAmount = money(attribute(totalTag, "СтТовУчНалВсего") ?? undefined);
  const vatTotalTag = openingTag(totalBlock, "СумНалВсего");
  const vatAmount = money(
    attribute(vatTotalTag, "СумНал")
      ?? totalBlock.match(/<(?:(?:[\w-]+):)?СумНал(?=\s|>)[^>]*>([^<]+)<\//i)?.[1],
  );
  if (!documentDate || !documentNumber || grossAmount == null || vatAmount == null || vatAmount > grossAmount) return null;
  const rates = [...xml.matchAll(/(?:^|\s)НалСт="([^"]+)"/gi)]
    .map((match) => Number(match[1].replace(/[^\d.,]/g, "").replace(",", ".")))
    .filter((rate) => [0, 5, 7, 10, 20, 22].includes(rate));
  const uniqueRates = [...new Set(rates)];
  return {
    documentNumber,
    documentDate,
    grossAmount,
    vatAmount,
    vatRate: uniqueRates.length === 1 ? uniqueRates[0] : null,
    sellerInn: partyInn(xml, "СвПрод"),
    buyerInn: partyInn(xml, "СвПокуп"),
  };
}

function xmlText(buffer: Buffer): string {
  const head = buffer.subarray(0, Math.min(buffer.length, 200)).toString("ascii");
  const encoding = /encoding=["']([^"']+)/i.exec(head)?.[1]?.toLowerCase();
  return new TextDecoder(encoding?.includes("1251") ? "windows-1251" : "utf-8").decode(buffer);
}

function zipEntries(buffer: Buffer): Buffer[] {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error("Архив WB больше 25 МБ");
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Архив WB повреждён: не найден ZIP-каталог");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  const result: Buffer[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Архив WB повреждён");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("В архиве WB слишком большой файл");
    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw new Error("Распакованный архив WB больше 50 МБ");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const content = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!content || content.length !== uncompressedSize) throw new Error(`Неподдерживаемое или повреждённое ZIP-сжатие WB: ${method}`);
    if (/^\s*(?:<\?xml|<Файл(?=\s|>))/i.test(xmlText(content))) result.push(content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

export function parseWbTaxDocumentFile(buffer: Buffer, extension: string, cabinetInn: string | null): ParsedWbTaxDocument | null {
  const xmlFiles = extension.toLowerCase() === "zip" ? zipEntries(buffer) : [buffer];
  const parsed = xmlFiles.map((file) => parseWbUpdXml(xmlText(file))).filter((item): item is ParsedWbTaxDocument => Boolean(item));
  const normalizedInn = cabinetInn?.replace(/\D/g, "") || null;
  return parsed.find((item) => normalizedInn && item.buyerInn === normalizedInn && item.sellerInn !== normalizedInn)
    ?? parsed.find((item) => !normalizedInn || item.sellerInn !== normalizedInn)
    ?? null;
}

export function isTaxDocumentCategory(item: Pick<WbDocumentListItem, "name" | "category">): boolean {
  return /(?:^|[^а-яё])(упд|укд)(?:[^а-яё]|$)|сч[её]т.?фактур|универсальн\w*\s+(?:передаточн\w*|корректировочн\w*)\s+документ/i.test(`${item.name} ${item.category}`);
}

export function stableTaxDocumentId(cabinetId: string, externalId: string, kind = "tax"): string {
  const hex = createHash("sha256").update(`${kind}:${cabinetId}:${externalId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function wbFetch(token: string, url: URL): Promise<Response> {
  const response = await fetch(url, { headers: { Authorization: token }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new WbDocumentsError(`WB Документы: ${response.status}${detail ? ` — ${detail}` : ""}`, response.status);
  }
  return response;
}

export async function listWbDocuments(token: string, from: string, to: string, offset: number): Promise<WbDocumentListItem[]> {
  const url = new URL(`${BASE}/list`);
  url.search = new URLSearchParams({ locale: "ru", beginTime: from, endTime: to, sort: "date", order: "desc", limit: "50", offset: String(offset) }).toString();
  const body = await (await wbFetch(token, url)).json() as { data?: { documents?: WbDocumentListItem[] } };
  return Array.isArray(body.data?.documents) ? body.data.documents : [];
}

export async function downloadWbDocument(token: string, serviceName: string, extension: string): Promise<Buffer> {
  const url = new URL(`${BASE}/download`);
  url.search = new URLSearchParams({ serviceName, extension }).toString();
  return Buffer.from(await (await wbFetch(token, url)).arrayBuffer());
}
