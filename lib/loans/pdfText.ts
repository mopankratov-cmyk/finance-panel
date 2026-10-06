import { inflateSync } from "node:zlib";

/**
 * Небольшой извлекатель текста из PDF без нативных бинарников и внешнего ИИ.
 *
 * Он намеренно не пытается быть универсальным рендерером PDF: нам нужен
 * надёжный резерв для договоров с текстовым слоем. Поддерживаются обычные
 * content streams (`Tj`/`TJ`), Flate-сжатие и ToUnicode-карты. Сканы честно
 * возвращают пустую строку — цифры графика в таком случае нельзя угадывать.
 */
type UnicodeMap = Map<string, string>;

function utf16be(bytes: Buffer) {
  if (bytes.length < 2 || bytes.length % 2) return bytes.toString("latin1");
  const units: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 2) units.push(bytes.readUInt16BE(offset));
  return String.fromCharCode(...units);
}

function pdfLiteralBytes(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    const next = value[++index] ?? "";
    if (next === "n") bytes.push(0x0a);
    else if (next === "r") bytes.push(0x0d);
    else if (next === "t") bytes.push(0x09);
    else if (next === "b") bytes.push(0x08);
    else if (next === "f") bytes.push(0x0c);
    else if (/[0-7]/.test(next)) {
      const octal = `${next}${value[index + 1] ?? ""}${value[index + 2] ?? ""}`.match(/^[0-7]{1,3}/)?.[0] ?? next;
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length - 1;
    } else if (next !== "\r" && next !== "\n") bytes.push(next.charCodeAt(0) & 0xff);
  }
  return Buffer.from(bytes);
}

function cmapFrom(streams: Buffer[]): UnicodeMap {
  const map: UnicodeMap = new Map();
  for (const stream of streams) {
    const text = stream.toString("latin1");
    if (!/beginbf(?:char|range)/.test(text)) continue;
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const match of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const source = match[1].toUpperCase();
        const target = Buffer.from(match[2], "hex");
        map.set(source, utf16be(target));
      }
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const match of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const start = Number.parseInt(match[1], 16);
        const end = Number.parseInt(match[2], 16);
        const target = Number.parseInt(match[3], 16);
        const width = match[1].length;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 10_000) continue;
        for (let code = start; code <= end; code++) map.set(code.toString(16).padStart(width, "0").toUpperCase(), String.fromCodePoint(target + code - start));
      }
    }
  }
  return map;
}

type PdfStream = {
  objectId: number | null;
  data: Buffer;
};

function decodeBytes(bytes: Buffer, map: UnicodeMap) {
  if (!map.size) return bytes.toString("latin1");
  const widths = [...new Set([...map.keys()].map((key) => key.length / 2))].sort((left, right) => right - left);
  let text = "";
  for (let offset = 0; offset < bytes.length;) {
    const width = widths.find((candidate) => offset + candidate <= bytes.length && map.has(bytes.subarray(offset, offset + candidate).toString("hex").toUpperCase()));
    if (!width) {
      text += bytes.subarray(offset, offset + 1).toString("latin1");
      offset++;
      continue;
    }
    const key = bytes.subarray(offset, offset + width).toString("hex").toUpperCase();
    text += map.get(key) ?? "";
    offset += width;
  }
  return text;
}

/**
 * Один PDF может содержать несколько шрифтов, у которых одинаковый код
 * глифа означает разные символы. Раньше карты объединялись, и последняя
 * молча портила даты/суммы предыдущих шрифтов (так устроены PDF JetLend).
 * Для отдельного фрагмента выбираем карту, дающую наиболее читаемый текст.
 */
function legibilityScore(text: string) {
  let score = 0;
  for (const char of text) {
    if (/[0-9]/.test(char)) score += 5;
    else if (/[A-Za-zА-Яа-яЁё]/u.test(char)) score += 3;
    else if (/\s|[.,:%№()\-+/@]/u.test(char)) score += 1;
    else if (char.charCodeAt(0) < 32) score -= 8;
    else score -= 3;
  }
  return score;
}

function decodeWithBestMap(bytes: Buffer, maps: UnicodeMap[]) {
  if (!maps.length) return bytes.toString("latin1");
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const map of maps) {
    const candidate = decodeBytes(bytes, map);
    const score = legibilityScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function streamsFromPdf(bytes: Buffer) {
  const source = bytes.toString("latin1");
  const streams: PdfStream[] = [];
  // Начинаем строго с indirect object и не пересекаем endobj. Иначе regex
  // мог принять словарь FontDescriptor за словарь следующего CMap-потока.
  const pattern = /(\d+)\s+\d+\s+obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g;
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const declaredLength = match[2].match(/\/Length\s+(\d+)\b/);
    const end = declaredLength ? start + Number(declaredLength[1]) : source.indexOf("endstream", start);
    if (end < start) continue;
    let stream = bytes.subarray(start, end);
    if (!declaredLength) {
      while (stream.length && /[\r\n]/.test(String.fromCharCode(stream.at(-1) ?? 0))) stream = stream.subarray(0, -1);
    }
    try {
      streams.push({
        objectId: Number(match[1]),
        data: /\/FlateDecode/.test(match[2]) ? inflateSync(stream) : stream,
      });
    } catch {
      // Повреждённый поток не должен мешать прочитать остальные страницы.
    }
  }
  return streams;
}

function fontMapsFromPdf(source: string, streams: PdfStream[]) {
  const cmapByObject = new Map<number, UnicodeMap>();
  for (const stream of streams) {
    if (stream.objectId == null || !/beginbf(?:char|range)/.test(stream.data.toString("latin1"))) continue;
    cmapByObject.set(stream.objectId, cmapFrom([stream.data]));
  }

  const cmapObjectByFontObject = new Map<number, number>();
  for (const match of source.matchAll(/(\d+)\s+\d+\s+obj\s*<<([\s\S]{0,2500}?)>>/g)) {
    const toUnicode = match[2].match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (toUnicode) cmapObjectByFontObject.set(Number(match[1]), Number(toUnicode[1]));
  }

  const maps = new Map<string, UnicodeMap>();
  for (const match of source.matchAll(/\/([^\s/<>{}\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const cmapObject = cmapObjectByFontObject.get(Number(match[2]));
    const cmap = cmapObject == null ? undefined : cmapByObject.get(cmapObject);
    if (cmap?.size) maps.set(match[1], cmap);
  }
  return maps;
}

/** Возвращает текстовый слой PDF; пустая строка означает, что нужен OCR/ручной ввод. */
export function extractPdfText(bytes: Buffer) {
  const streams = streamsFromPdf(bytes);
  const source = bytes.toString("latin1");
  const fontMaps = fontMapsFromPdf(source, streams);
  const maps = [...new Set(fontMaps.values())];
  const chunks: string[] = [];
  for (const stream of streams) {
    const content = stream.data.toString("latin1");
    if (/beginbf(?:char|range)/.test(content)) continue;
    let activeMap: UnicodeMap | undefined;
    const operators = /\b(?:BT|ET)\b|\/([^\s/<>{}\[\]()]+)\s+[-+]?\d*\.?\d+\s+Tf|<([0-9A-Fa-f\s]+)>\s*Tj|(\((?:\\.|[^\\)])*\))\s*Tj|\[((?:[^\]\\]|\\.)*)\]\s*TJ/g;
    for (const match of content.matchAll(operators)) {
      if (match[0] === "BT" || match[0] === "ET") {
        chunks.push(" ");
        continue;
      }
      if (match[1] != null) {
        activeMap = fontMaps.get(match[1]);
        continue;
      }
      const token = match[0];
      const decode = (value: Buffer) => activeMap ? decodeBytes(value, activeMap) : decodeWithBestMap(value, maps);
      if (match[2] != null) chunks.push(decode(Buffer.from(match[2].replace(/\s+/g, ""), "hex")));
      else if (match[3] != null) chunks.push(decode(pdfLiteralBytes(match[3].slice(1, -1))));
      else {
        for (const item of token.matchAll(/<([0-9A-Fa-f\s]+)>|\((?:\\.|[^\\)])*\)/g)) {
          chunks.push(item[1] != null
            ? decode(Buffer.from(item[1].replace(/\s+/g, ""), "hex"))
            : decode(pdfLiteralBytes(item[0].slice(1, -1))));
        }
      }
    }
  }
  // В Chromium/Skia один визуальный текст часто разбит на отдельный Tj для
  // каждого глифа. Искусственный пробел между операторами превращал даты в
  // `0 8 . 1 2 . 2 0 2 4`; настоящие пробелы уже присутствуют в CMap.
  return chunks.join("").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
