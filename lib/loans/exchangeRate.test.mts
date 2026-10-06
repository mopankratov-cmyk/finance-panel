import assert from "node:assert/strict";
import test from "node:test";
import { fetchCbrRate } from "./exchangeRate.ts";

test("исторический курс запрашивается у ЦБ на дату платежа и возвращает ISO-дату", async () => {
  const previousFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(`<?xml version="1.0"?><ValCurs Date="08.08.2026"><Valute ID="R01235"><Nominal>1</Nominal><Value>82,1665</Value></Valute></ValCurs>`);
  }) as typeof fetch;
  try {
    const result = await fetchCbrRate("USD", "2026-08-10");
    assert.match(requested, /date_req=10\/08\/2026$/);
    assert.equal(result.rate, 82.1665);
    assert.equal(result.date, "2026-08-08");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
