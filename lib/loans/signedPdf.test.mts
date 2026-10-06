import assert from "node:assert/strict";
import test from "node:test";
import { pdfFromSignedContainer } from "./signedPdf";

const CMS_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

test("извлекает PDF из подписанного CMS-контейнера", () => {
  const source = Buffer.concat([Buffer.from("%PDF-1.7\ncontract\n%%EOF"), Buffer.from([0x00, 0x01])]);
  const signed = Buffer.concat([Buffer.from([0x30, 0x82, 0x00, 0x20]), CMS_OID, Buffer.from([0xa0, 0x03]), source, Buffer.from([0xde, 0xad])]);
  assert.deepEqual(pdfFromSignedContainer(signed), Buffer.from("%PDF-1.7\ncontract\n%%EOF"));
});

test("не принимает произвольный бинарный файл с текстом PDF", () => {
  assert.equal(pdfFromSignedContainer(Buffer.from("not a CMS %PDF-1.7\n%%EOF")), null);
});
