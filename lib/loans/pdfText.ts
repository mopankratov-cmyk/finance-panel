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

function decodePdfLiteral(value: string) {
  let text = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char !== "\\") {
      text += char;
      continue;
    }
    const next = value[++index] ?? "";
    if (next === "n") text += "\n";
    else if (next === "r") text += "\r";
    else if (next === "t") text += "\t";
    else if (next === "b") text += "\b";
    else if (next === "f") text += "\f";
    else if (/[0-7]/.test(next)) {
      const octal = `${next}${value[index + 1] ?? ""}${value[index + 2] ?? ""}`.match(/^[0-7]{1,3}/)?.[0] ?? next;
      text += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length - 1;
    } else if (next !== "\r" && next !== "\n") text += next;
  }
  return text;
}

function cmapFrom(streams: Buffer[]): UnicodeMap {
  const map: UnicodeMap = new Map();
  for (const stream of streams) {
    const text = stream.toString("latin1");
    if (!/beginbf(?:char|range)/.test(text)) continue;
    for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const source = match[1].toUpperCase();
      const target = Buffer.from(match[2], "hex");
      map.set(source, utf16be(target));
    }
    for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(match[1], 16);
      const end = Number.parseInt(match[2], 16);
      const target = Number.parseInt(match[3], 16);
      const width = match[1].length;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 10_000) continue;
      for (let code = start; code <= end; code++) map.set(code.toString(16).padStart(width, "0").toUpperCase(), String.fromCodePoint(target + code - start));
    }
  }
  return map;
}

function decodeHex(value: string, map: UnicodeMap) {
  const bytes = Buffer.from(value.replace(/\s+/g, ""), "hex");
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

function streamsFromPdf(bytes: Buffer) {
  const source = bytes.toString("latin1");
  const streams: Buffer[] = [];
  const pattern = /<<([\s\S]{0,4000}?)>>\s*stream\r?\n/g;
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf("endstream", start);
    if (end < start) continue;
    let stream = bytes.subarray(start, end);
    while (stream.length && /[\r\n]/.test(String.fromCharCode(stream.at(-1) ?? 0))) stream = stream.subarray(0, -1);
    try {
      streams.push(/\/FlateDecode/.test(match[1]) ? inflateSync(stream) : stream);
    } catch {
      // Повреждённый поток не должен мешать прочитать остальные страницы.
    }
  }
  return streams;
}

/** Возвращает текстовый слой PDF; пустая строка означает, что нужен OCR/ручной ввод. */
export function extractPdfText(bytes: Buffer) {
  const streams = streamsFromPdf(bytes);
  const map = cmapFrom(streams);
  const chunks: string[] = [];
  for (const stream of streams) {
    const content = stream.toString("latin1");
    if (/beginbf(?:char|range)/.test(content)) continue;
    for (const match of content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj|\((?:\\.|[^\\)])*\)\s*Tj|\[(.*?)\]\s*TJ/g)) {
      const token = match[0];
      const inner = match[1];
      if (inner != null) chunks.push(decodeHex(inner, map));
      else if (token.startsWith("(")) chunks.push(decodePdfLiteral(token.slice(1, token.lastIndexOf(")"))));
      else {
        for (const item of token.matchAll(/<([0-9A-Fa-f\s]+)>|\((?:\\.|[^\\)])*\)/g)) {
          chunks.push(item[1] != null ? decodeHex(item[1], map) : decodePdfLiteral(item[0].slice(1, -1)));
        }
      }
    }
  }
  return chunks.join(" ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
