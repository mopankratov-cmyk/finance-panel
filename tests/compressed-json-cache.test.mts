import assert from "node:assert/strict";
import test from "node:test";
import { decodeCompressedJson, encodeCompressedJson } from "../lib/cache/compressedJson";

test("dashboard snapshots round-trip through compressed cache storage", () => {
  const snapshot = {
    generatedAt: "2026-07-13T18:00:00.000Z",
    rows: Array.from({ length: 8_000 }, (_, index) => ({
      nm: index,
      article: `NORVIA-${index}`,
      metrics: Array.from({ length: 14 }, (_, day) => ({ day, orders: index % 7, revenue: index * day })),
    })),
  };
  const rawBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const encoded = encodeCompressedJson(snapshot);
  assert.deepEqual(decodeCompressedJson<typeof snapshot>(encoded), snapshot);
  assert.ok(Buffer.byteLength(encoded) < rawBytes / 2);
});
