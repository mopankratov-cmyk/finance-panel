import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareTestForStart, restoreOriginalCover } from "../lib/ctrtest/originalCover";
import { isLiveWbCoverUrl, needsPin, pinImageFromUrl, sniffImageMime } from "../lib/ctrtest/pinImage";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Витрина WB принадлежит владельцу, а не тесту. Тест 13 (сентябрь 2026) показал,
 * как это ломается: «Текущее фото» хранилось ссылкой на живую обложку
 * (`…/images/big/1.webp` — адрес ПОЗИЦИИ карточки), после первой смены та же
 * ссылка отдавала уже подставленный вариант, и исходное фото не вернулось ни в
 * ходе теста, ни после него. Здесь проверяется, что копии закрепляются, а
 * возврат обложки происходит и не гаснет молча.
 */

// ── Вспомогательное: фальшивая база и подмена fetch ───────────────────────────

interface Call { table: string; op: string; payload?: unknown; filters: unknown[][] }
type Reply = { data?: unknown; error?: { code?: string; message: string } | null };

function fakeDb(handler: (call: Call) => Reply = () => ({})) {
  const calls: Call[] = [];
  const uploads: { bucket: string; path: string; contentType: string; size: number }[] = [];
  const removed: string[][] = [];
  const state = { uploadError: null as string | null };

  class Query {
    call: Call;
    constructor(table: string) { this.call = { table, op: "select", filters: [] }; }
    select() { return this; }
    update(payload: unknown) { this.call.op = "update"; this.call.payload = payload; return this; }
    insert(payload: unknown) { this.call.op = "insert"; this.call.payload = payload; return this; }
    eq(...args: unknown[]) { this.call.filters.push(["eq", ...args]); return this; }
    order() { return this; }
    maybeSingle() { return this.run(); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return this.run().then(resolve, reject); }
    run() {
      calls.push(this.call);
      const reply = handler(this.call);
      return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
    }
  }

  const db = {
    from: (table: string) => new Query(table),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array, options: { contentType: string }) => {
          if (state.uploadError) return { data: null, error: { message: state.uploadError } };
          uploads.push({ bucket, path, contentType: options.contentType, size: bytes.length });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        remove: async (paths: string[]) => { removed.push(paths); return { data: null, error: null }; },
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, calls, uploads, removed, state };
}

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);
const HTML = new TextEncoder().encode("<html><body>404</body></html>");

async function withFetch<T>(handler: (url: string) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

const LIVE = "https://basket-35.wbbasket.ru/vol7555/part755558/755558108/images/big/1.webp";
const OWN = "https://ref.supabase.co/storage/v1/object/public/factory-media/ctr-pinned/cab/1/a.webp";

// ── Что считается живой ссылкой и что надо копировать ────────────────────────

test("ссылка на фото карточки WB — живая, файл в нашем хранилище — нет", () => {
  assert.equal(isLiveWbCoverUrl(LIVE), true);
  assert.equal(isLiveWbCoverUrl("https://basket-04.wbbasket.ru/vol1/part1/1/images/c246x328/1.webp"), true);
  assert.equal(isLiveWbCoverUrl(OWN), false);
  assert.equal(isLiveWbCoverUrl("https://example.com/a.webp"), false);
  assert.equal(isLiveWbCoverUrl(""), false);
});

test("копию нужно делать со всего, что лежит не у нас", () => {
  assert.equal(needsPin(LIVE), true);
  assert.equal(needsPin("https://example.com/a.jpg"), true, "внешняя ссылка может умереть к моменту записи в карточку");
  assert.equal(needsPin(OWN), false, "файл в нашем хранилище не меняется");
  assert.equal(needsPin("/api/lab/yandex-img?path=x"), false, "относительный путь наружу не отдать, и копировать его не с чего");
  assert.equal(needsPin(""), false);
});

test("тип файла определяется по байтам, а не по заголовку", () => {
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageMime(HTML), null);
});

// ── Закрепление копии ─────────────────────────────────────────────────────────

test("копия картинки ложится в бакет под префикс ctr-pinned и получает публичный адрес", async () => {
  const { db, uploads } = fakeDb();
  const result = await withFetch(() => new Response(WEBP), () => pinImageFromUrl(db, { url: LIVE, cabinetId: "cab-1", nmId: 123 }));
  assert.equal(result.ok, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].bucket, "factory-media");
  assert.match(uploads[0].path, /^ctr-pinned\/cab-1\/123\/[0-9a-f-]{36}\.webp$/);
  assert.equal(uploads[0].contentType, "image/webp");
  assert.ok(result.ok && result.url.includes("/storage/v1/object/public/factory-media/ctr-pinned/"));
  assert.ok(result.ok && !needsPin(result.url), "закреплённая копия сама копирования не требует");
});

test("не картинка, недоступный адрес и отказ хранилища — отказ, а не «положили что получилось»", async () => {
  const notImage = await withFetch(() => new Response(HTML), () => pinImageFromUrl(fakeDb().db, { url: "https://example.com/x", cabinetId: "c", nmId: 1 }));
  assert.equal(notImage.ok, false);
  assert.match(notImage.ok ? "" : notImage.error, /не картинка/);

  const gone = await withFetch(() => new Response("", { status: 404 }), () => pinImageFromUrl(fakeDb().db, { url: LIVE, cabinetId: "c", nmId: 1 }));
  assert.equal(gone.ok, false);
  assert.match(gone.ok ? "" : gone.error, /HTTP 404/);

  const storage = fakeDb();
  storage.state.uploadError = "bucket full";
  const rejected = await withFetch(() => new Response(WEBP), () => pinImageFromUrl(storage.db, { url: LIVE, cabinetId: "c", nmId: 1 }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.ok ? "" : rejected.error, /bucket full/);
});

// ── Подготовка к запуску ──────────────────────────────────────────────────────

test("на старте варианты и исходная обложка становятся копиями, адрес оригинала пишется в тест", async () => {
  const { db, calls, uploads } = fakeDb((call) => {
    if (call.table === "ctr_variants" && call.op === "select") {
      return { data: [{ id: 11, label: "Вариант A", image_url: "https://example.com/a.jpg" }, { id: 12, label: "Вариант B", image_url: OWN }] };
    }
    return {};
  });
  const result = await withFetch(() => new Response(WEBP), () => prepareTestForStart(db, { testId: 9, cabinetId: "cab", nmId: 5 }, { resolveSource: async () => LIVE }));
  assert.deepEqual(result, { ok: true });
  assert.equal(uploads.length, 2, "внешний вариант и обложка; вариант из нашего хранилища не копируется");

  const testUpdate = calls.find((call) => call.table === "ctr_tests" && call.op === "update");
  const payload = testUpdate?.payload as { original_cover_url: string; cover_swapped_at: null; cover_restored_at: null };
  assert.ok(payload.original_cover_url.includes("ctr-pinned/"));
  assert.equal(payload.cover_swapped_at, null, "отметки прежнего запуска сбрасываются");
  assert.equal(payload.cover_restored_at, null);

  const variantUpdate = calls.find((call) => call.table === "ctr_variants" && call.op === "update");
  assert.equal((variantUpdate?.payload as { image_url: string }).image_url.includes("ctr-pinned/"), true, "вариант теперь ссылается на копию");
  assert.deepEqual(variantUpdate?.filters, [["eq", "id", 11]]);
});

test("не нашли обложку или не смогли её скопировать — тест не стартует и мусор за собой убирает", async () => {
  const noSource = fakeDb((call) => (call.table === "ctr_variants" ? { data: [{ id: 1, label: "A", image_url: "https://example.com/a.jpg" }] } : {}));
  const missing = await withFetch(() => new Response(WEBP), () => prepareTestForStart(noSource.db, { testId: 1, cabinetId: "c", nmId: 1 }, { resolveSource: async () => null }));
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.status, 502);
  assert.equal(noSource.removed.flat().length, 1, "копия варианта, уже сложенная в бакет, удаляется");

  const broken = fakeDb((call) => (call.table === "ctr_variants" ? { data: [] } : {}));
  const failed = await withFetch(() => new Response("", { status: 500 }), () => prepareTestForStart(broken.db, { testId: 1, cabinetId: "c", nmId: 1 }, { resolveSource: async () => LIVE }));
  assert.equal(failed.ok, false);
  assert.match(!failed.ok ? failed.error : "", /Тест не запущен/);
});

test("без применённой миграции тест не стартует: возвращать обложку было бы некуда", async () => {
  const { db, removed } = fakeDb((call) => {
    if (call.table === "ctr_variants") return { data: [] };
    if (call.table === "ctr_tests" && call.op === "update") return { error: { code: "42703", message: 'column "original_cover_url" does not exist' } };
    return {};
  });
  const result = await withFetch(() => new Response(WEBP), () => prepareTestForStart(db, { testId: 1, cabinetId: "c", nmId: 1 }, { resolveSource: async () => LIVE }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 503);
  assert.match(!result.ok ? result.error : "", /202609210001_ctr_test_original_cover/);
  assert.equal(removed.flat().length, 1, "сохранённая копия обложки не остаётся висеть в бакете");
});

// ── Возврат обложки ───────────────────────────────────────────────────────────

const row = (extra: Record<string, unknown> = {}) => ({
  original_cover_url: OWN, cover_swapped_at: "2026-09-18T12:05:00Z", cover_restored_at: null, ...extra,
});

test("исходная обложка возвращается, метка и событие пишутся", async () => {
  const { db, calls } = fakeDb((call) => (call.op === "select" ? { data: row() } : {}));
  const written: { nmId: number; url: string }[] = [];
  const result = await restoreOriginalCover(db, { id: 13, nm_id: 755558108 }, "token", "ctr-rotate", {
    replaceCover: async (_token, nmId, url) => { written.push({ nmId, url }); return { ok: true }; },
  });
  assert.deepEqual(result, { status: "restored" });
  assert.deepEqual(written, [{ nmId: 755558108, url: OWN }]);
  const stamp = calls.find((call) => call.op === "update");
  assert.ok((stamp?.payload as { cover_restored_at: string }).cover_restored_at);
  const event = calls.find((call) => call.op === "insert");
  assert.equal((event?.payload as { action: string }).action, "cover_restored");
});

test("отказ WB при возврате не гасит очередь: метка не ставится, повтор возможен", async () => {
  const { db, calls } = fakeDb((call) => (call.op === "select" ? { data: row() } : {}));
  const result = await restoreOriginalCover(db, { id: 13, nm_id: 1 }, "token", "ctr-rotate", {
    replaceCover: async () => ({ ok: false, error: "WB 429" }),
  });
  assert.deepEqual(result, { status: "failed", error: "WB 429" });
  assert.equal(calls.some((call) => call.op === "update"), false, "cover_restored_at остаётся пустым — крон попробует снова");
});

test("возвращать нечего, если витрина не менялась, обложку уже вернули или копии нет", async () => {
  const noWrite = { replaceCover: async () => { throw new Error("запись в WB не должна вызываться"); } };
  const cases: [Record<string, unknown>, string][] = [
    [{ cover_swapped_at: null }, "never-swapped"],
    [{ cover_restored_at: "2026-09-19T10:00:00Z" }, "already-restored"],
    [{ original_cover_url: null }, "no-original"],
  ];
  for (const [extra, reason] of cases) {
    const { db } = fakeDb((call) => (call.op === "select" ? { data: row(extra) } : {}));
    assert.deepEqual(await restoreOriginalCover(db, { id: 1, nm_id: 1 }, "t", "a", noWrite), { status: "skipped", reason });
  }
  const { db } = fakeDb(() => ({ error: { code: "42703", message: "no column" } }));
  assert.deepEqual(await restoreOriginalCover(db, { id: 1, nm_id: 1 }, "t", "a", noWrite), { status: "skipped", reason: "migration-missing" });
});

// ── Порядок и границы в роутах ────────────────────────────────────────────────

test("крон не кладёт в карточку живую ссылку и возвращает обложку после конца теста", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  const guard = route.indexOf("isLiveWbCoverUrl(next.image_url)");
  const write = route.indexOf("replaceCardCover(");
  const transition = route.indexOf('rpc("transition_ctr_test"');
  const restore = route.indexOf("restoreOriginalCover(db, { id: test.id");
  assert.ok(guard > 0 && write > 0 && transition > 0 && restore > 0);
  assert.ok(guard < write, "живой адрес отсекается ДО записи в карточку");
  assert.ok(restore > transition, "возврат — после того как тест закрылся");
  assert.match(route, /cover_swapped_at: new Date\(\)\.toISOString\(\)/, "метка «витрина менялась» ставится после записи");
  assert.ok(route.indexOf("cover_swapped_at") < transition, "метка стоит до отметки раунда, чтобы сбой ниже её не потерял");
  // Очередь возврата не гаснет: тесты без метки cover_restored_at перебираются на каждом проходе.
  assert.match(route, /\.not\("cover_swapped_at", "is", null\)\.is\("cover_restored_at", null\)/);
});

test("запуск сохраняет копии до первой смены, завершение возвращает обложку", () => {
  const route = read("../app/api/ctrtest/[id]/action/route.ts");
  const prepare = route.indexOf("prepareTestForStart(");
  const snapshot = route.indexOf("getCtrMetricSnapshot(cabinetId");
  const restore = route.indexOf("restoreOriginalCover(");
  assert.ok(prepare > 0 && snapshot > 0 && restore > 0);
  assert.ok(prepare < snapshot, "копии снимаются до первого раунда");
  assert.match(route, /test\.status === "draft"/, "только на первом старте: после смены снять исходную обложку уже нечем");
  assert.match(route, /status === "done" \|\| status === "cancelled"/);
});

test("создание теста копирует картинки до записи в базу", () => {
  const route = read("../app/api/ctrtest/list/route.ts");
  assert.ok(route.indexOf("needsPin(variant.imageUrl)") < route.indexOf('rpc("create_ctr_test"'));
  assert.match(route, /removePinned\(db, pinnedPaths\)/, "не вышло создать — копии за собой убираем");
});

test("мастер не добавляет текущее фото вариантом сам", () => {
  const wizard = read("../components/wb/ctr/CtrTestWizard.tsx");
  assert.doesNotMatch(wizard, /wbCardImageUrl/, "живая ссылка на обложку в варианты больше не попадает");
  assert.doesNotMatch(wizard, /"Текущее фото"/);
  assert.match(wizard, /label: "Вариант A"/);
});

test("миграция заводит три колонки", () => {
  const sql = read("../supabase/migrations/202609210001_ctr_test_original_cover.sql");
  for (const column of ["original_cover_url", "cover_swapped_at", "cover_restored_at"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`));
  }
});
