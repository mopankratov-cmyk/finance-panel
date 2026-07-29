import assert from "node:assert/strict";
import test from "node:test";
import { compareWbSupplyGoods, compareWbSupplyPackages, normalizeWbSupplyId, supplyWarehouseMatches } from "../lib/supplies/wbSupply";
import { fetchFbwSupplySnapshot } from "../lib/wb/fbwSupplies";

test("WB supply id accepts only a positive safe integer", () => {
  assert.equal(normalizeWbSupplyId(" 26596368 "), 26596368);
  assert.equal(normalizeWbSupplyId("WB-26596368"), null);
  assert.equal(normalizeWbSupplyId("0"), null);
});

test("WB supply must belong to the planned warehouse", () => {
  assert.equal(supplyWarehouseMatches("Коледино", { warehouseName: "Коледино" }), true);
  assert.equal(supplyWarehouseMatches("Краснодар", { warehouseName: "Коледино", actualWarehouseName: "Коледино" }), false);
  assert.equal(supplyWarehouseMatches("Обухово", { warehouseName: "Краснодар", transitWarehouseName: "Обухово" }), false);
});

test("goods comparison is exact by barcode and quantity", () => {
  const ok = compareWbSupplyGoods([{ barcode: "4601", quantity: 4 }, { barcode: "4601", quantity: 6 }], [{ barcode: "4601", quantity: 10 }]);
  assert.equal(ok.ok, true);
  const mismatch = compareWbSupplyGoods([{ barcode: "4601", quantity: 10 }], [{ barcode: "4601", quantity: 9 }, { barcode: "999", quantity: 1 }]);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.mismatched[0].actual, 9);
  assert.equal(mismatch.extra[0].key, "999");
});

test("package comparison verifies each barcode inside each box", () => {
  const result = compareWbSupplyPackages(
    [{ container: "WB_1", barcode: "4601", quantity: 5 }, { container: "WB_2", barcode: "4602", quantity: 3 }],
    [{ packageCode: "WB_1", quantity: 5, barcodes: [{ barcode: "4601", quantity: 5 }] }, { packageCode: "WB_2", quantity: 3, barcodes: [{ barcode: "4602", quantity: 3 }] }],
  );
  assert.equal(result.ok, true);
});

test("a supply can be verified before WB packaging is uploaded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/goods?")) return new Response(JSON.stringify([{ barcode: "4601", vendorCode: "SKU", nmID: 10, quantity: 5 }]), { status: 200 });
    if (url.endsWith("/package")) return new Response(JSON.stringify({ title: "package not formed" }), { status: 400 });
    return new Response(JSON.stringify({ statusID: 2, boxTypeID: 1, warehouseName: "Коледино", quantity: 5 }), { status: 200 });
  }) as typeof fetch;
  try {
    const snapshot = await fetchFbwSupplySnapshot("token", 123);
    assert.equal(snapshot.detail.warehouseName, "Коледино");
    assert.equal(snapshot.goods.length, 1);
    assert.deepEqual(snapshot.packages, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
