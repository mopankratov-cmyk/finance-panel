import assert from "node:assert/strict";
import test from "node:test";
import { DIRECT_UPLOAD_THRESHOLD_BYTES, isUploadObjectPath, uploadObjectPath } from "./uploadStorage.ts";

test("путь объекта безопасен, сохраняет расширение и проходит проверку", () => {
  const path = uploadObjectPath("Договор №12/2026 (скан).PDF");
  assert.match(path, /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/Договор_12_2026_скан_\.PDF$/);
  assert.equal(isUploadObjectPath(path), true);
  assert.equal(isUploadObjectPath("../etc/passwd"), false);
  assert.equal(isUploadObjectPath("2026-09-04/not-a-uuid/x.pdf"), false);
  assert.throws(() => uploadObjectPath("script.exe"), /Поддерживаются/);
});

test("порог прямой загрузки ниже лимита Vercel 4,5 МБ", () => {
  assert.ok(DIRECT_UPLOAD_THRESHOLD_BYTES < 4.5 * 1024 * 1024);
});
