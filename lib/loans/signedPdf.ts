/**
 * Некоторые ЭДО выгружают подписанный PDF как CMS/PKCS#7-контейнер, но
 * оставляют расширение `.pdf`. Внутри SignedData лежит исходный PDF, а не
 * произвольный файл. Извлекаем его только из такого контейнера — простое
 * присутствие строки `%PDF-` в чужом файле не делает файл документом.
 */
const CMS_SIGNED_DATA_OID = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02,
]);
const PDF_HEADER = Buffer.from("%PDF-");
const PDF_END = Buffer.from("%%EOF");

function contains(bytes: Buffer, needle: Buffer) {
  return bytes.indexOf(needle) >= 0;
}

/** Возвращает вложенный PDF из CMS SignedData или null для иных файлов. */
export function pdfFromSignedContainer(bytes: Buffer): Buffer | null {
  // ASN.1 DER SignedData всегда начинается с SEQUENCE; OID защищает от
  // ложного извлечения PDF, случайно встретившегося в другом бинарном файле.
  if (bytes[0] !== 0x30 || !contains(bytes, CMS_SIGNED_DATA_OID)) return null;
  const start = bytes.indexOf(PDF_HEADER);
  const end = bytes.lastIndexOf(PDF_END);
  if (start < 0 || end < start) return null;
  const pdf = bytes.subarray(start, end + PDF_END.length);
  return pdf.length >= PDF_HEADER.length ? Buffer.from(pdf) : null;
}
