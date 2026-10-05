import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("OzonOpiuPage fetches the report route and renders date inputs, a cabinet filter and the total row", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/opiu\/ozon/, "must call the report API route");
  assert.match(source, /marketplace\s*===\s*["']ozon["']/, "must filter cabinets to Ozon on the client");
  assert.match(source, /type="date"/, "must render a date range picker");
  assert.match(source, /report\.totalLabel/, "must render the total row label from the report (ИТОГО К ВЫПЛАТЕ, as in the sheet)");
  assert.match(source, /не подключено/, "must render the Себестоимость stub label");
});

test("OzonOpiuPage renders the new-category banner conditionally, not unconditionally", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(source, /newCategories/, "must reference the report's newCategories field");
  assert.match(
    source,
    /newCategories\.length\s*>\s*0|newCategories\.length\s*\?/,
    "the banner must be gated on newCategories being non-empty, not always shown",
  );
});

test("OzonOpiuPage visually marks the top-level Заказы funnel as informational, not part of the total (finding I3)", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(source, /не входит в сумму/, "must tell the user the orders funnel isn't summed into К выплате");
});

test("OzonOpiuPage ignores a stale response from an older request (finding I6)", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /AbortController|requestId|requestSeq/,
    "must guard against an older, slower request overwriting a newer one's result",
  );
});

test("OzonOpiuPage renders a data-range warning from the API when the period predates the accrual backfill window (finding I7)", async () => {
  const source = await readFile(new URL("../components/opiu/OzonOpiuPage.tsx", import.meta.url), "utf8");
  assert.match(source, /warning/, "must read and render the route's warning field");
});
