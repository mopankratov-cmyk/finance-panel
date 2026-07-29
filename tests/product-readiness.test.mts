import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductNote, productReadiness } from "../lib/wb/productReadiness";

test("product readiness names every missing Content API field", () => {
  const result = productReadiness({ name: "Ковёр", brand: "NORVIA", subject: "Ковры", length: 120, width: 80, height: null, weightBrutto: 2, materials: "Хлопок", photosCount: 2 });
  assert.equal(result.score, 71);
  assert.deepEqual(result.missing, ["Размеры", "Минимум 3 фото"]);
});

test("a complete product has a 100 percent readiness score", () => {
  const result = productReadiness({ name: "Ковёр", brand: "NORVIA", subject: "Ковры", length: 120, width: 80, height: 1, weightBrutto: 2, materials: "Хлопок", photosCount: 3 });
  assert.equal(result.score, 100);
  assert.deepEqual(result.missing, []);
});

test("product notes accept only a Drive folder and a known status", () => {
  const valid = normalizeProductNote({ status: "in_progress", comment: "  Добавить фото  ", driveUrl: "https://drive.google.com/drive/folders/abc" });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.comment, "Добавить фото");
  assert.equal(normalizeProductNote({ status: "done", driveUrl: "" }).ok, false);
  assert.equal(normalizeProductNote({ status: "ready", driveUrl: "https://example.com/folder" }).ok, false);
});
