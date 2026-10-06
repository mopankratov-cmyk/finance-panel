import assert from "node:assert/strict";
import test from "node:test";
import {
  readBrowserReportCache,
  reportCacheKey,
  writeBrowserReportCache,
} from "./browserReportCache.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("report cache survives a new read and does not expire by time", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  const key = reportCacheKey("opiu-month", ["2026-08"]);
  const stored = writeBrowserReportCache(key, { total: 123 });
  const loaded = readBrowserReportCache<{ total: number }>(key);

  assert.deepEqual(loaded, stored);
  assert.equal(loaded?.data.total, 123);
  delete (globalThis as { window?: unknown }).window;
});

test("снимок прежней версии кэша не читается и убирается при следующей записи", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  const key = reportCacheKey("opiu-month", ["2026-10-05", "norvia"]);
  const legacyKey = `finance-panel:report-cache:v1:${key}`;
  localStorage.setItem(legacyKey, JSON.stringify({ savedAt: 1, data: { rows: ["старый вид без блока «Расходы ниже EBITDA»"] } }));

  assert.equal(readBrowserReportCache(key), null, "старый снимок v1 не должен подхватываться");

  writeBrowserReportCache(key, { rows: ["новый вид"] });
  assert.equal(localStorage.getItem(legacyKey), null, "после записи v1-снимок удалён");
  assert.deepEqual(readBrowserReportCache<{ rows: string[] }>(key)?.data, { rows: ["новый вид"] });
  delete (globalThis as { window?: unknown }).window;
});

test("report cache key separates filters", () => {
  assert.notEqual(
    reportCacheKey("wb", ["2026-08-31", "norvia"]),
    reportCacheKey("wb", ["2026-08-31", "heaton"]),
  );
});
