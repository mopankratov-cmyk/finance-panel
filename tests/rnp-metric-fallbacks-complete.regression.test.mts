import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { RNP_METRIC_FIELDS } from "../lib/rnp/operatingMatrix";

// Страница РНП строит список метрик по ВСЕМУ каталогу через METRIC_FALLBACKS.
// Поле каталога без фолбэка роняло весь экран («This page couldn't load»):
// TypeError на .label у undefined внутри useMemo. Каталог и фолбэки живут в
// разных файлах и легко расходятся — этот тест сторожит пару.

test("у каждого поля каталога есть фолбэк на странице РНП", async () => {
  const page = await readFile(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  const start = page.indexOf("const METRIC_FALLBACKS");
  assert.ok(start > 0, "METRIC_FALLBACKS не найден");
  const block = page.slice(start, page.indexOf("};", start));
  const missing = (RNP_METRIC_FIELDS as readonly string[]).filter((field) => !new RegExp(`(^|\\n)\\s*${field}:`).test(block));
  assert.deepEqual(missing, [], `в METRIC_FALLBACKS нет полей: ${missing.join(", ")}`);
});

test("расхождение каталога и фолбэков деградирует, а не роняет экран", async () => {
  const page = await readFile(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  assert.match(page, /METRIC_FALLBACKS\[field\]\?\.label \?\? field/);
});
