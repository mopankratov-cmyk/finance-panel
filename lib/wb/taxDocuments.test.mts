import assert from "node:assert/strict";
import test from "node:test";
import { isTaxDocumentCategory, parseWbUpdXml, stableTaxDocumentId } from "./taxDocuments.ts";

const XML = `<?xml version="1.0" encoding="windows-1251"?>
<Файл><Документ><СвСчФакт НомерСчФ="УПД-42" ДатаСчФ="25.09.2026" />
<СвПрод><ИдСв><СвЮЛУч ИННЮЛ="7721546864" /></ИдСв></СвПрод>
<СвПокуп><ИдСв><СвИП ИННФЛ="330573647518" /></ИдСв></СвПокуп>
<ТаблСчФакт><СведТов НалСт="22%" /></ТаблСчФакт>
<ВсегоОпл СтТовУчНалВсего="1220.00"><СумНалВсего><СумНал>220.00</СумНал></СумНалВсего></ВсегоОпл>
</Документ></Файл>`;

test("parses FNS UPD totals and parties", () => {
  assert.deepEqual(parseWbUpdXml(XML), {
    documentNumber: "УПД-42", documentDate: "2026-09-25", grossAmount: 1220,
    vatAmount: 220, vatRate: 22, sellerInn: "7721546864", buyerInn: "330573647518",
  });
});

test("recognizes only tax document categories", () => {
  assert.equal(isTaxDocumentCategory({ name: "upd-services", category: "УПД на услуги" }), true);
  assert.equal(isTaxDocumentCategory({ name: "redeem-notification", category: "Уведомление о выкупе" }), false);
});

test("stable IDs are deterministic UUIDs", () => {
  const id = stableTaxDocumentId("cab", "document");
  assert.equal(id, stableTaxDocumentId("cab", "document"));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});
