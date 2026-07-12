import assert from "node:assert/strict";
import test from "node:test";

import { fetchAcceptanceCoefficients } from "../lib/wb/supplies";

test("acceptance coefficients use the current common WB tariffs endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{
      date: "2026-07-12T00:00:00Z",
      warehouseID: 507,
      warehouseName: "Коледино",
      boxTypeID: 2,
      coefficient: 1,
      allowUnload: true,
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const rows = await fetchAcceptanceCoefficients("test-token", [507]);
    assert.equal(
      requestedUrl,
      "https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients?warehouseIDs=507",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.warehouseName, "Коледино");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
