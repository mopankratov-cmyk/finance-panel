// Минимальный генератор XLSX без зависимостей: один лист, строки/числа.
// Собираем OOXML-части и упаковываем в ZIP методом STORE (без сжатия) — нужен
// только CRC32. Достаточно для выгрузок-таблиц (Excel/LibreOffice/WB открывают).

type Cell = string | number | null | undefined;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipFile { name: string; data: Buffer }

function zipStore(files: ZipFile[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // local file header sig
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(0, 8); // method 0 = store
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0x21, 12); // mod date = 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len
    local.push(lh, nameBuf, f.data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // central dir header sig
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42); // local header offset
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + size;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // EOCD sig
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16); // central dir offset
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBuf, end]);
}

/**
 * Текст ячейки в XML.
 *
 * XLSX — это XML, а XML 1.0 запрещает управляющие символы (кроме табуляции и
 * перевода строки). Коды маркировки Честного Знака содержат разделитель GS
 * (0x1D) между группами — и он уезжал в файл как есть. Excel такой документ не
 * читает: он «чинит» его, ВЫБРАСЫВАЯ содержимое листа, и человек видит пустую
 * таблицу вместо девятнадцати кодов. Ошибки при этом никакой — ни в панели, ни
 * в Excel.
 *
 * Управляющие символы записываем в том виде, в каком их пишет сам Excel:
 * `_xHHHH_`. При открытии он превращает их обратно в исходный символ, поэтому
 * код не портится. Литеральную последовательность `_xHHHH_` в тексте
 * экранируем, иначе она превратилась бы в символ при чтении.
 */
const esc = (s: string) =>
  s
    .replace(/_(x[0-9A-Fa-f]{4})_/g, "_x005F_$1_")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // eslint-disable-next-line no-control-regex -- ровно эти символы XML и запрещает
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (ch) =>
      `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);

function colRef(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Готовый файл пригоден к открытию.
 *
 * Проверяем результат, а не намерение: однажды документ на девятнадцать кодов
 * весил девять килобайт и открывался в Excel ПУСТЫМ — разделитель GS внутри
 * кода делал XML недопустимым, и Excel «чинил» книгу, выбрасывая лист. Ошибки
 * не было нигде: ни в панели, ни в Excel.
 *
 * Смотреть можно ТОЛЬКО в лист. XLSX — это ZIP, и его собственные заголовки
 * начинаются с байтов «PK\x03\x04»: проверка по всему файлу срабатывает на
 * любом документе, всегда — и вместо редкой поломки книги получается отказ
 * сборки на каждой выгрузке.
 */
export function assertSheetIsUsable(file: Buffer, expectedRows: number) {
  const xml = file.toString("utf8");
  const start = xml.indexOf("<sheetData>");
  const end = xml.indexOf("</sheetData>");
  if (start < 0 || end <= start) throw new Error("В документе нет листа — файл собрался неверно");
  const body = xml.slice(start, end);
  const rowCount = (body.match(/<row\b/g) ?? []).length;
  if (rowCount < expectedRows + 1) {
    throw new Error(`В документе ${Math.max(0, rowCount - 1)} строк вместо ${expectedRows} — файл собрался неверно`);
  }
  // eslint-disable-next-line no-control-regex -- ровно эти символы и ломают книгу
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) {
    throw new Error("В документе остались управляющие символы — Excel откроет его пустым");
  }
}

export function buildXlsx(sheetName: string, rows: Cell[][]): Buffer {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((val, c) => {
          if (val === null || val === undefined || val === "") return "";
          const ref = `${colRef(c)}${r + 1}`;
          if (typeof val === "number" && Number.isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(val))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  const sn = (esc(sheetName).slice(0, 31) || "Лист1");
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${sn}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const B = (s: string) => Buffer.from(s, "utf8");
  return zipStore([
    { name: "[Content_Types].xml", data: B(contentTypes) },
    { name: "_rels/.rels", data: B(rootRels) },
    { name: "xl/workbook.xml", data: B(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: B(wbRels) },
    { name: "xl/worksheets/sheet1.xml", data: B(sheet) },
  ]);
}
