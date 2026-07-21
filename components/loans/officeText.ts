async function inflateRaw(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

async function unzip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let central = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_558); offset--) {
    if (u32(view, offset) === 0x06054b50) {
      central = u32(view, offset + 16);
      break;
    }
  }
  if (central < 0) throw new Error("Файл Office повреждён или защищён паролем");
  let offset = central;
  while (offset + 46 < bytes.length && u32(view, offset) === 0x02014b50) {
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (/\.(xml|rels)$/i.test(name)) {
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(start, start + compressedSize);
      const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
      if (data) files.set(name, decoder.decode(data));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function readableXml(xml: string) {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/(?:row|si)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export async function extractOfficeText(file: File) {
  const files = await unzip(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".docx")) {
    const document = files.get("word/document.xml");
    if (!document) throw new Error("В DOCX не найден текст договора");
    return readableXml(document);
  }
  const selected = [...files.entries()]
    .filter(([name]) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .map(([, xml]) => readableXml(xml));
  if (!selected.length) throw new Error("В Excel не найдены читаемые листы");
  return selected.join("\n");
}
