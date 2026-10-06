import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccuracySummary, SampleCards, SampleCardView, sampleImageSrc, samplePhotoState, TraitsSection, type SamplePhoto } from "../components/assortment/PhotoTraits.tsx";
import {
  ACCURACY_LOWER_MIN, ACCURACY_MIN_JUDGED, accuracyLabel, fieldAccuracy, hiddenReason, summarizeVerdicts, wilsonLower, wilsonUpper,
} from "../lib/assortment/attributeVerdicts.ts";
import { loadAccuracy, loadVerdicts, saveVerdict, VerdictInputError, VerdictTableMissingError } from "../lib/assortment/attributeVerdictsStore.ts";
import { PROMPT_VERSION, type PhotoTraitsReport } from "../lib/assortment/catalogAi.ts";
import { loadPhotoSamples, type PhotoSample } from "../lib/assortment/catalogAiStore.ts";

const NOW = Date.parse("2026-10-06T10:00:00Z");

/** Эталон точности разбора по фото: отметки «верно / неверно / не понять» человеком (05.10). Пороги — наше решение. */

const root = fileURLToPath(new URL("..", import.meta.url));
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("Интервал Уилсона: нет отметок — null; 12 из 12 — нижняя граница ≈ 76% (а не 100%); растёт с числом отметок", () => {
  assert.equal(wilsonLower(0, 0), null);
  const l12 = wilsonLower(12, 12)!;
  assert.ok(l12 > 0.75 && l12 < 0.77, `12/12 → ${l12}`);
  assert.ok(wilsonLower(45, 45)! > wilsonLower(12, 12)!, "больше отметок — уже интервал");
  assert.ok(wilsonLower(0, 20)! === 0 || wilsonLower(0, 20)! < 0.01);
  assert.ok(wilsonLower(17, 20)! < 0.65, "17 из 20 (85%) — нижняя граница заметно ниже 85%");
});

test("Точность признака: мало отметок — «не измерена»; нижняя граница ≥ порога — надёжна; ниже — ненадёжна; «не понять» в точность не входит", () => {
  assert.equal(fieldAccuracy(10, 0, 0).status, "unmeasured", `10 безошибочных < ${ACCURACY_MIN_JUDGED}`);
  assert.equal(fieldAccuracy(0, 0, 10).status, "unmeasured", "горстка «не понять» — просто не измерено");
  assert.equal(fieldAccuracy(0, 0, 10).accuracy, null);
  const reliable = fieldAccuracy(25, 0, 3);
  assert.equal(reliable.status, "reliable");
  assert.ok((reliable.lower ?? 0) >= ACCURACY_LOWER_MIN);
  assert.equal(reliable.judged, 25, "«не понять» не в знаменателе");
  const unreliable = fieldAccuracy(17, 3, 0);
  assert.equal(unreliable.status, "unreliable");
  assert.equal(unreliable.accuracy, 0.85);
  assert.equal(fieldAccuracy(19, 1, 0).status, "unreliable", "95% при 20 отметках — нижняя граница всё ещё ниже 80%");
});

test("«Не понять» не входит в точность, но и не молчит: 20 «верно» при 80 «не понять» — не «надёжно», а «по фото не проверить»; доли такого признака прячутся", () => {
  const murky = fieldAccuracy(20, 0, 80);
  assert.equal(murky.status, "unreliable");
  assert.equal(murky.reason, "unverifiable");
  assert.equal(murky.accuracy, 1, "точность по тому, что удалось проверить, прежняя");
  assert.match(hiddenReason(murky)!, /по 100 отметкам «не понять» у 80% \(порог — 30%\): этот признак по фото человеку не проверить/);
  const allUnclear = fieldAccuracy(0, 0, 30);
  assert.equal(allUnclear.status, "unreliable", "30 отметок «не понять» и ни одной проверенной — это не «размечено 0 из 20», а признак без проверки");
  assert.match(accuracyLabel(allUnclear), /размечено 0 из 20; не понять: 30/);
  assert.equal(fieldAccuracy(25, 0, 10).status, "reliable", "29% «не понять» — в пределах нормы");
  assert.equal(fieldAccuracy(25, 0, 12).status, "unreliable", "32% — уже нет");
  assert.match(accuracyLabel(fieldAccuracy(25, 0, 3)), /верно 25 из 25 \(100%, нижняя граница \d+%\); не понять: 3$/, "число «не понять» видно в подписи");
});

test("Ждать двадцатой отметки незачем, если даже верхняя граница интервала ниже порога: 2 «верно» из 6 прячут доли сразу, 5 из 5 — ещё нет", () => {
  assert.ok(wilsonUpper(0, 0) === null);
  assert.ok(wilsonUpper(6, 6)! === 1 || wilsonUpper(6, 6)! > 0.99);
  const early = fieldAccuracy(2, 4, 0);
  assert.equal(early.status, "unreliable");
  assert.equal(early.reason, "low");
  assert.match(hiddenReason(early)!, /по 6 размеченным моделям верно 33%: даже в лучшем случае \(верхняя граница \d+%\) это ниже порога 80%/);
  assert.equal(fieldAccuracy(5, 0, 0).status, "unmeasured");
  assert.equal(fieldAccuracy(1, 3, 0).status, "unmeasured", "4 отметки — меньше, чем нужно, чтобы судить рано");
});

test("Округление не врёт: нижняя граница 79,x% подписана как 79%, а не «80% ниже порога 80%»", () => {
  let found = 0;
  for (let n = 20; n <= 300; n += 1) {
    for (let ok = 0; ok <= n; ok += 1) {
      const lower = wilsonLower(ok, n)!;
      if (lower < 0.795 || lower >= ACCURACY_LOWER_MIN) continue;
      found += 1;
      const a = fieldAccuracy(ok, n - ok, 0);
      assert.equal(a.status, "unreliable");
      assert.match(hiddenReason(a)!, /нижняя граница 79% ниже порога 80%/, `${ok} из ${n}`);
      assert.match(accuracyLabel(a), /нижняя граница 79%/);
    }
  }
  assert.ok(found > 0, "нашёлся хотя бы один пограничный случай");
});

test("Округление верхней границы и доли «не понять»: рядом с порогом никогда не «80% ниже 80%» и не «30%» при условии «больше 30%»", () => {
  let early = 0;
  for (let n = 5; n < 20; n += 1) {
    for (let ok = 0; ok <= n; ok += 1) {
      const upper = wilsonUpper(ok, n)!;
      const a = fieldAccuracy(ok, n - ok, 0);
      if (a.status !== "unreliable") continue;
      early += 1;
      const shown = Number(/верхняя граница (\d+)%/.exec(hiddenReason(a)!)![1]);
      assert.ok(shown < 80, `${ok} из ${n}: верхняя граница ${upper} показана как ${shown}%`);
    }
  }
  assert.ok(early > 0);
  const murky = hiddenReason(fieldAccuracy(16, 0, 7))!;
  assert.match(murky, /у 30,4% \(порог — 30%\)/, "доля с десятыми: «30%» рядом с порогом «больше 30%» читалось бы как «не выше порога»");
  const footnote = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: {} })));
  assert.match(footnote, /больше 30% \(при 20 и более отметках\)/, "сноска называет тот же порог, что и код");
  assert.doesNotMatch(footnote, /трети/);
});

test("Сводка отметок: по признакам, неизвестный вердикт игнорируется; подписи и причина скрытия доли", () => {
  const s = summarizeVerdicts([
    ...Array.from({ length: 21 }, () => ({ field_key: "silhouette", verdict: "ok" as const })),
    { field_key: "silhouette", verdict: "unclear" as const },
    ...Array.from({ length: 5 }, () => ({ field_key: "proportions", verdict: "ok" as const })),
    ...Array.from({ length: 5 }, () => ({ field_key: "proportions", verdict: "wrong" as const })),
    { field_key: "carry", verdict: "bogus" as never },
  ]);
  assert.equal(s.silhouette.status, "reliable");
  assert.equal(s.silhouette.unclear, 1);
  assert.equal(s.proportions.judged, 10);
  assert.match(accuracyLabel(s.silhouette), /^верно 21 из 21 \(100%, нижняя граница \d+%\); не понять: 1$/);
  assert.match(accuracyLabel(s.proportions), /верно 5 из 10 \(50%, нижняя граница \d+%\)/);
  assert.match(accuracyLabel(undefined), /точность не измерена: размечено 0 из 20/);
  assert.equal(hiddenReason(s.silhouette), null);
  assert.match(hiddenReason(s.proportions)!, /даже в лучшем случае/, "5 из 10 при верхней границе ниже порога — прячем, не дожидаясь двадцати");
  const pending = fieldAccuracy(8, 2, 0);
  assert.equal(hiddenReason(pending), null, "пока мало отметок и надежда есть — доли не прячем, только честно подписываем");
  assert.match(accuracyLabel(pending), /верно 8 из 10 \(80%, нижняя граница \d+%\) — пока мало: нужно 20/);
  const bad = fieldAccuracy(17, 3, 0);
  assert.match(hiddenReason(bad)!, /по 20 размеченным моделям верно 85%, нижняя граница \d+% ниже порога 80%/);
});

// --- подставная база ---

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const writes: Array<{ op: string; table: string; row?: Row; where?: Row }> = [];
  const db = {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      let del = false;
      const rows = () => (tables[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
      const failure = opts.missing?.includes(table) ? { code: "42P01", message: `relation "${table}" does not exist` } : null;
      const result = () => (failure ? { data: null, error: failure } : { data: rows(), error: null });
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
        // Остальные фильтры вида голов подставной базе не нужны: все её строки им удовлетворяют.
        gte: () => q, is: () => q, not: () => q, or: () => q, in: () => q, neq: () => q,
        order: () => q,
        range: (a: number, b: number) => Promise.resolve(failure ? { data: null, error: failure } : { data: rows().slice(a, b + 1), error: null }),
        maybeSingle: () => Promise.resolve(failure ? { data: null, error: failure } : { data: rows()[0] ?? null, error: null }),
        delete: () => { del = true; return q; },
        upsert: (row: Row) => { writes.push({ op: "upsert", table, row }); return Promise.resolve({ error: failure }); },
        then: (resolve: (v: unknown) => unknown) => {
          if (del) writes.push({ op: "delete", table, where: Object.fromEntries(eqs) });
          return Promise.resolve(del ? { error: failure } : result()).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as never, writes };
}

const attrs = (over: Row = {}) => ({ silhouette: { v: "тоут", c: 0.9 }, hood: { v: null, nv: true }, ...over });
const result = (over: Row = {}): Row => ({ source_id: "S001", model_key: "S001|a", direction: "bags", status: "ok", model: "polza:google/gemini-2.5-flash", prompt_version: PROMPT_VERSION, attributes: attrs(), taken_at: "2026-10-06T08:00:00Z", ...over });
const input = (over: Row = {}) => ({ direction: "bags" as const, sourceId: "S001", modelKey: "S001|a", field: "silhouette", verdict: "ok" as const, ...over });

test("Отметка: версия вопроса и модель берутся из строки разбора, а не от клиента; повтор той же отметки — тот же ключ (одна строка)", async () => {
  const { db, writes } = fakeDb({ assortment_model_attributes: [result({ prompt_version: "catalog-v2", model: "polza:m" })] });
  await saveVerdict(db, input(), "owner@example.com");
  const w = writes[0];
  assert.equal(w.op, "upsert");
  assert.equal(w.table, "assortment_attribute_verdict");
  assert.equal(w.row?.prompt_version, "catalog-v2");
  assert.equal(w.row?.ai_model, "polza:m");
  assert.equal(w.row?.judged_by, "owner@example.com");
  assert.equal(w.row?.verdict, "ok");
  assert.equal(w.row?.field_key, "silhouette");
});

test("Отметка: нет такого признака у раздела, нет разбора, разбор неудачный, ИИ написал «не видно» — отказ; null снимает отметку; нет таблицы — понятная ошибка", async () => {
  const good = fakeDb({ assortment_model_attributes: [result()] });
  await assert.rejects(() => saveVerdict(good.db, input({ field: "subtype" }), "x"), VerdictInputError, "subtype — признак курток, не сумок");
  await assert.rejects(() => saveVerdict(good.db, input({ modelKey: "S001|none" }), "x"), VerdictInputError);
  await assert.rejects(() => saveVerdict(good.db, input({ field: "hood" }), "x"), VerdictInputError, "у сумок нет капюшона");
  const jackets = fakeDb({ assortment_model_attributes: [result({ direction: "jackets", attributes: { hood: { v: null, nv: true } } })] });
  await assert.rejects(() => saveVerdict(jackets.db, input({ direction: "jackets", field: "hood" }), "x"), /«не видно»/);
  const failed = fakeDb({ assortment_model_attributes: [result({ status: "failed" })] });
  await assert.rejects(() => saveVerdict(failed.db, input(), "x"), VerdictInputError);
  assert.equal(good.writes.length + jackets.writes.length + failed.writes.length, 0, "при отказе ничего не записано");
  const clear = fakeDb({ assortment_model_attributes: [result()] });
  await saveVerdict(clear.db, input({ verdict: null }), "x");
  assert.equal(clear.writes[0].op, "delete");
  assert.equal(clear.writes[0].where?.field_key, "silhouette");
  assert.equal(clear.writes[0].where?.prompt_version, PROMPT_VERSION);
  const noTable = fakeDb({ assortment_model_attributes: [result()] }, { missing: ["assortment_attribute_verdict"] });
  await assert.rejects(() => saveVerdict(noTable.db, input(), "x"), VerdictTableMissingError);
});

test("Отметка по разбору прежней версии вопроса не принимается (в точность она не войдёт); снять старую отметку можно; цвет и фактура — свободный текст, их не размечают", async () => {
  const legacy = fakeDb({ assortment_model_attributes: [result({ prompt_version: "catalog-v1" })] });
  await assert.rejects(() => saveVerdict(legacy.db, input(), "x"), (e: unknown) => e instanceof VerdictInputError && /прежней версии вопроса/.test(e.message));
  assert.equal(legacy.writes.length, 0, "ничего не записано");
  await saveVerdict(legacy.db, input({ verdict: null }), "x");
  assert.equal(legacy.writes[0].op, "delete", "старую отметку снять можно");
  assert.equal(legacy.writes[0].where?.prompt_version, "catalog-v1");
  const free = fakeDb({ assortment_model_attributes: [result({ attributes: attrs({ color: { v: "бежевый", c: 0.9 }, texture: { v: "гладкая", c: 0.8 } }) })] });
  await assert.rejects(() => saveVerdict(free.db, input({ field: "color" }), "x"), (e: unknown) => e instanceof VerdictInputError && /свободный текст/.test(e.message));
  await assert.rejects(() => saveVerdict(free.db, input({ field: "texture" }), "x"), VerdictInputError);
  assert.equal(free.writes.length, 0);
  await saveVerdict(free.db, input(), "x");
  assert.equal(free.writes.length, 1, "обычный признак той же модели принимается");
});

test("Чтение отметок: только раздел и текущая версия вопроса; нет таблицы — null (а не пустая точность)", async () => {
  const rows = [
    { source_id: "S1", model_key: "a", direction: "bags", field_key: "silhouette", prompt_version: PROMPT_VERSION, verdict: "ok" },
    { source_id: "S1", model_key: "b", direction: "bags", field_key: "silhouette", prompt_version: "catalog-v1", verdict: "wrong" },
    { source_id: "S1", model_key: "c", direction: "jackets", field_key: "subtype", prompt_version: PROMPT_VERSION, verdict: "ok" },
  ];
  const { db } = fakeDb({ assortment_attribute_verdict: rows });
  assert.deepEqual((await loadVerdicts(db, "bags"))!.map((r) => r.model_key), ["a"], "версия v1 и другой раздел не входят");
  assert.equal((await loadAccuracy(db, "bags"))!.silhouette.ok, 1);
  const none = fakeDb({}, { missing: ["assortment_attribute_verdict"] });
  assert.equal(await loadVerdicts(none.db, "bags"), null);
  assert.equal(await loadAccuracy(none.db, "bags"), null);
});

// --- примеры с отметками ---

function samplesDb(verdictRows: Row[] | null) {
  const head = (id: string) => ({ source_id: "S001", source_item_id: id, model_key: `S001|${id}`, direction: "bags", title: `Bag ${id}`, image_urls: [`https://img/${id}.jpg`], model_first_seen_at: "2026-10-01T00:00:00Z", handle: null, product_type: null, model_last_seen_at: "2026-10-05T00:00:00Z", model_baseline: true, reference_id: null, brand: null, badges: null, variants: 1, model_hidden_at: null });
  return fakeDb({
    assortment_catalog_heads: [head("a"), head("b"), head("c")],
    assortment_sources: [{ source_id: "S001", name: "Zara" }],
    assortment_model_attributes: [
      result({ model_key: "S001|a" }), result({ model_key: "S001|b" }), result({ model_key: "S001|c", prompt_version: "catalog-v1" }),
    ],
    ...(verdictRows ? { assortment_attribute_verdict: verdictRows } : {}),
  });
}

test("Примеры: у разбора по текущей версии — его отметки и ключ модели; у прежней версии отметок нет; «только без отметок» исключает размеченные", async () => {
  const verdicts = [{ source_id: "S001", model_key: "S001|a", field_key: "silhouette", verdict: "wrong" as const }];
  const { db } = samplesDb([]);
  const all = (await loadPhotoSamples(db, "bags", { limit: 12, verdicts, nowMs: NOW }))!;
  assert.equal(all.verdictsAvailable, true);
  assert.equal(all.judgedModels, 1);
  const a = all.samples.find((s) => s.modelKey === "S001|a")!;
  assert.deepEqual(a.verdicts, { silhouette: "wrong" });
  assert.equal(a.promptVersion, PROMPT_VERSION);
  const legacy = all.samples.find((s) => s.modelKey === "S001|c")!;
  assert.equal(legacy.promptVersion, "catalog-v1");
  assert.deepEqual(legacy.verdicts, {});
  const fresh = (await loadPhotoSamples(db, "bags", { limit: 12, verdicts, onlyUnjudged: true, nowMs: NOW }))!;
  assert.ok(!fresh.samples.some((s) => s.modelKey === "S001|a"), "размеченная модель не предлагается снова");
  assert.equal(fresh.analyzed, 3, "разобрано — все, а не только неразмеченные");
  const noTable = (await loadPhotoSamples(db, "bags", { limit: 12, verdicts: null, nowMs: NOW }))!;
  assert.equal(noTable.verdictsAvailable, false, "таблицы нет — кнопок не будет");
  const notAsked = (await loadPhotoSamples(db, "bags", { limit: 12, nowMs: NOW }))!;
  assert.equal(notAsked.verdictsAvailable, false);
});

function pool(rowsByKey: Record<string, Row>, verdictRows: Row[] = []) {
  const head = (key: string) => ({ source_id: "S001", source_item_id: key, model_key: `S001|${key}`, direction: "bags", title: `Bag ${key}`, image_urls: [`https://img/${key}.jpg`], model_first_seen_at: "2026-10-01T00:00:00Z", handle: null, product_type: null, model_last_seen_at: "2026-10-05T00:00:00Z", model_baseline: true, reference_id: null, brand: null, badges: null, variants: 1, model_hidden_at: null });
  return fakeDb({
    assortment_catalog_heads: Object.keys(rowsByKey).map(head),
    assortment_sources: [{ source_id: "S001", name: "Zara" }],
    assortment_model_attributes: Object.entries(rowsByKey).map(([key, over]) => result({ model_key: `S001|${key}`, ...over })),
    assortment_attribute_verdict: verdictRows,
  });
}
const two = { silhouette: { v: "тоут", c: 0.9 }, proportions: { v: "средняя", c: 0.8 } };
const mark = (key: string, field: string, verdict = "ok" as const) => ({ source_id: "S001", model_key: `S001|${key}`, field_key: field, verdict });

test("Разметка подряд: прежняя версия разбора в набор не попадает; модель с одним признаком из двух возвращается, с обоими — нет; «не видно» и свободный текст отмечать не требуют", async () => {
  const verdicts = [mark("partial", "silhouette"), mark("done", "silhouette"), mark("done", "proportions", "unclear" as never)];
  const { db } = pool({
    fresh: { attributes: two },
    partial: { attributes: two },
    done: { attributes: two },
    legacy: { attributes: two, prompt_version: "catalog-v1" },
    onlyNotVisible: { attributes: { silhouette: { v: null, nv: true } } },
    onlyFreeText: { attributes: { color: { v: "бежевый", c: 0.9 } } },
  });
  const r = (await loadPhotoSamples(db, "bags", { limit: 24, verdicts, onlyUnjudged: true, nowMs: NOW }))!;
  assert.deepEqual(r.samples.map((x) => x.modelKey).sort(), ["S001|fresh", "S001|partial"], "legacy, done, onlyNotVisible и onlyFreeText не предлагаются");
  assert.equal(r.unjudgedModels, 2, "сколько ещё осталось, считается тем же правилом");
  assert.equal(r.analyzed, 6, "разобрано — все");
  assert.equal(r.judgedModels, 2, "размечено — модели, у которых есть хоть одна отметка");
  const all = (await loadPhotoSamples(db, "bags", { limit: 24, verdicts, nowMs: NOW }))!;
  assert.equal(all.samples.length, 6, "обычный просмотр показывает всё, включая прежнюю версию");
  assert.equal(all.unjudgedModels, 2);
});

// --- экран ---

const sample = (over: Partial<PhotoSample> = {}): PhotoSample => ({
  sourceId: "S001", sourceName: "Zara", title: "Bag a", imageUrl: "https://img/a.jpg", itemId: "a", model: "polza:m", takenAt: "2026-10-06T08:00:00Z",
  modelKey: "S001|a", promptVersion: PROMPT_VERSION, verdicts: {},
  attributes: [
    { key: "silhouette", label: "Силуэт", value: "тоут", notVisible: false, confidence: 0.9 },
    { key: "carry", label: "Способ ношения", value: null, notVisible: true, confidence: null },
  ], ...over,
});
const judging = { currentVersion: PROMPT_VERSION, busyKeys: new Set<string>(), errors: {} as Record<string, string>, onVerdict: () => undefined };
/** Карточки в заданном состоянии фото. Через SampleCards (как в экране) первая отрисовка всегда «фото грузится» — кнопок тогда нет. */
const cards = (samples: PhotoSample[], judgingProps: typeof judging | undefined, photo: SamplePhoto = "loaded") =>
  renderToStaticMarkup(createElement("div", null, ...samples.map((s, i) => createElement(SampleCardView, { key: i, sample: s, judging: judgingProps, photo }))));

test("Карточки в режиме разметки: кнопки «Верно / Неверно / Не понять» у написанного ИИ признака ≥40 px; у «не видно» и у прежней версии кнопок нет; без режима — как раньше", () => {
  const html = cards([sample({ verdicts: { silhouette: "wrong" } })], judging);
  assert.equal((html.match(/aria-pressed/g) ?? []).length, 3, "три кнопки, только у «Силуэта»");
  assert.match(html, /aria-label="Точность: Силуэт"/);
  assert.doesNotMatch(html, /aria-label="Точность: Способ ношения"/, "«не видно» отмечать нечего");
  assert.match(html, /aria-pressed="true"[^>]*>Неверно/, "текущая отметка подсвечена");
  assert.match(html, /h-10 min-w-10/);
  const legacy = cards([sample({ promptVersion: "catalog-v1" })], judging);
  assert.doesNotMatch(legacy, /aria-pressed/, "прежняя версия вопроса — отметка в точность не войдёт, кнопок нет (прячем, не серим)");
  assert.doesNotMatch(legacy, /disabled/);
  const free = cards([sample({ attributes: [
    { key: "color", label: "Цвет", value: "бежевый", notVisible: false, confidence: 0.9 },
    { key: "texture", label: "Фактура", value: "гладкая", notVisible: false, confidence: 0.9 },
    { key: "silhouette", label: "Силуэт", value: "тоут", notVisible: false, confidence: 0.9 },
  ] })], judging);
  assert.equal((free.match(/aria-pressed/g) ?? []).length, 3, "кнопки только у «Силуэта»: цвет и фактура — свободный текст");
  assert.doesNotMatch(free, /aria-label="Точность: (Цвет|Фактура)"/);
  const plain = cards([sample()], undefined);
  assert.doesNotMatch(plain, /aria-pressed/);
  const noKey = cards([sample({ modelKey: undefined })], judging);
  assert.doesNotMatch(noKey, /aria-pressed/);
});

test("Фото примера: прямая ссылка, затем через панель по строке каталога; без фото кнопок «верно/неверно» нет (отмечать вслепую нельзя) — и это названо", () => {
  const withPhoto = sample();
  assert.equal(sampleImageSrc(withPhoto, "direct"), "https://img/a.jpg");
  assert.equal(sampleImageSrc(withPhoto, "proxy"), "/api/assortment-development/catalog/photo?source=S001&item=a&n=0");
  assert.equal(sampleImageSrc({ ...withPhoto, itemId: undefined }, "proxy"), "https://img/a.jpg", "строки каталога нет — прокси не из чего собрать");
  const html = cards([withPhoto], judging);
  assert.match(html, /<img src="https:\/\/img\/a\.jpg"/);
  assert.equal((html.match(/aria-pressed/g) ?? []).length, 3);
  assert.doesNotMatch(flat(html), /отметить признаки нечем/);
  const noPhoto = cards([sample({ imageUrl: null })], judging, "none");
  assert.doesNotMatch(noPhoto, /aria-pressed/, "картинки нет — кнопок нет (прячем, не серим)");
  assert.match(flat(noPhoto), /Фото нет — отметить признаки нечем/);
  assert.match(noPhoto, /нет фото/);
  const plain = cards([sample({ imageUrl: null })], undefined, "none");
  assert.doesNotMatch(flat(plain), /отметить признаки нечем/, "в обычном просмотре (без разметки) этого сообщения нет");
});

test("Ревью #1531/17: пока фото грузится — «Фото загружается…» и ни одной кнопки (в экране первая отрисовка именно такая); кнопки — только после того, как оно открылось", () => {
  const fresh = renderToStaticMarkup(createElement(SampleCards, { samples: [sample()], judging }));
  assert.doesNotMatch(fresh, /aria-pressed/, "фото ещё не открылось — отметка была бы вслепую");
  assert.match(flat(fresh), /Фото загружается…/);
  assert.doesNotMatch(flat(fresh), /Фото не открылось|Фото нет/);
  assert.match(fresh, /<img src="https:\/\/img\/a\.jpg"/, "картинка в карточке есть и грузится");
  assert.equal((cards([sample()], judging, "loaded").match(/aria-pressed/g) ?? []).length, 3, "открылось — три кнопки");
  assert.doesNotMatch(flat(cards([sample()], judging, "loaded")), /Фото загружается/);
  // Без режима разметки подсказки про фото нет вовсе, а у разбора прежней версии кнопок не будет никогда — обещать их нечего.
  assert.doesNotMatch(flat(renderToStaticMarkup(createElement(SampleCards, { samples: [sample()] }))), /Фото загружается/);
  assert.doesNotMatch(flat(renderToStaticMarkup(createElement(SampleCards, { samples: [sample({ promptVersion: "catalog-v1" })], judging }))), /Фото загружается/);
});

test("Ревью #1531/17: состояние фото — по адресу текущего этапа; после перехода на запасной путь прежнее «открылось» не переносится", () => {
  const s = sample();
  const direct = sampleImageSrc(s, "direct");
  const proxy = sampleImageSrc(s, "proxy");
  assert.equal(samplePhotoState(s, "direct", null), "loading");
  assert.equal(samplePhotoState(s, "direct", direct), "loaded");
  assert.equal(samplePhotoState(s, "proxy", direct), "loading", "открылась прямая, но этап уже запасной — это другая картинка");
  assert.equal(samplePhotoState(s, "proxy", proxy), "loaded");
  assert.equal(samplePhotoState(s, "failed", proxy), "failed", "после «не открылось» — только failed, что бы ни стояло в loadedSrc");
  assert.equal(samplePhotoState(sample({ imageUrl: null }), "direct", null), "none");
  const source = readFileSync(join(root, "components/assortment/PhotoTraits.tsx"), "utf8");
  assert.match(source, /onLoad=\{onLoad\}/, "у картинки есть обработчик открытия");
  assert.match(source, /onLoad=\{\(\) => setLoadedSrc\(src\)\}/, "открытие запоминается по адресу");
});

test("Ревью #1531/17: не открылось фото — уже поставленная отметка не пропадает: её видно («Отметка: верно») и можно снять; новых отметок нет", () => {
  const marked = sample({ verdicts: { silhouette: "ok" } });
  for (const photo of ["failed", "none"] as const) {
    const html = cards([photo === "none" ? { ...marked, imageUrl: null } : marked], { ...judging }, photo);
    assert.doesNotMatch(html, /aria-pressed/, "трёх кнопок «верно/неверно/не понять» нет: ставить отметку вслепую нельзя");
    assert.match(flat(html), /Отметка: верно/, `${photo}: текущая отметка показана`);
    assert.match(flat(html), /Снять отметку/, `${photo}: её можно снять`);
    assert.match(flat(html), /отметить признаки нечем/);
  }
  // Грузится — отметка видна, но снять пока нельзя (фото может открыться, тогда будут обычные кнопки).
  const loading = cards([marked], judging, "loading");
  assert.match(flat(loading), /Отметка: верно/);
  assert.doesNotMatch(flat(loading), /Снять отметку/);
  assert.doesNotMatch(loading, /aria-pressed/);
  // Нет отметки — нет и строки про неё.
  assert.doesNotMatch(flat(cards([sample()], judging, "failed")), /Отметка:|Снять отметку/);
  // Другая версия вопроса: отметка в точность не входит, как и раньше — не показывается.
  assert.doesNotMatch(flat(cards([sample({ promptVersion: "catalog-v1", verdicts: { silhouette: "ok" } })], judging, "failed")), /Отметка:/);
  // Сбой сохранения (например, снятия) виден, даже когда фото не открылось.
  const key = "S001:S001|a:silhouette";
  assert.match(cards([marked], { ...judging, errors: { [key]: "Нет связи" } }, "failed"), /role="alert"[^>]*>Не сохранилось: Нет связи/);
  // «Снять» занята, пока отметка сохраняется.
  assert.match(cards([marked], { ...judging, busyKeys: new Set([key]) }, "failed"), /disabled=""[^>]*>\s*Снять отметку/);
});

test("Сохранение отметки: кнопки именно этого признака недоступны, остальные рабочие; сбой показан под признаком, а не под всей сеткой", () => {
  const key = "S001:S001|a:silhouette";
  const html = cards([sample({ attributes: [
      { key: "silhouette", label: "Силуэт", value: "тоут", notVisible: false, confidence: 0.9 },
      { key: "proportions", label: "Пропорции", value: "средняя", notVisible: false, confidence: 0.9 },
    ] })], { ...judging, busyKeys: new Set([key]), errors: { "S001:S001|a:proportions": "Нет связи" } });
  const groups = html.split('role="group"').slice(1);
  assert.equal(groups.length, 2);
  assert.equal((groups[0].split("</span>")[0].match(/disabled=""/g) ?? []).length, 3, "у «Силуэта» сохраняется отметка — три кнопки заняты");
  assert.doesNotMatch(groups[1].split("</dd>")[0], /disabled=""/, "у «Пропорций» кнопки рабочие: клик не теряется");
  assert.match(html, /role="alert"[^>]*>Не сохранилось: Нет связи/);
  assert.ok(html.indexOf("Не сохранилось") > html.indexOf('aria-label="Точность: Пропорции"'), "сообщение стоит у признака, у которого не сохранилось");
});

const report = (): PhotoTraitsReport => ({
  direction: "bags", analyzed: 60, legacy: 0, catalog: 100, coverage: 60, sourcesInAverage: 0, basis: "raw", averageCoverage: 0,
  fields: [
    { key: "silhouette", label: "Силуэт", visible: 60, notVisible: 0, values: [{ value: "тоут", models: 40, share: 66.7, avgSourceShare: null, sources: 3 }], other: null },
    { key: "proportions", label: "Пропорции", visible: 60, notVisible: 0, values: [{ value: "средняя", models: 30, share: 50, avgSourceShare: null, sources: 3 }], other: null },
    { key: "rigidity", label: "Жёсткость формы", visible: 60, notVisible: 0, values: [{ value: "мягкая", models: 30, share: 50, avgSourceShare: null, sources: 3 }], other: null },
  ],
});

test("Карточка признака: подпись точности; при ненадёжной (нижняя граница ниже порога) доли скрыты с причиной; нет таблицы отметок — строк про точность нет", () => {
  const accuracy = {
    silhouette: fieldAccuracy(40, 0, 0),
    proportions: fieldAccuracy(17, 3, 0),
    rigidity: fieldAccuracy(4, 1, 0),
  };
  const t = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy })));
  assert.match(t, /Силуэт видно у 60.*Точность разбора: верно 40 из 40 \(100%, нижняя граница \d+%\)\./);
  assert.match(t, /Пропорции.*Доли не показываем: по 20 размеченным моделям верно 85%, нижняя граница \d+% ниже порога 80%/);
  assert.doesNotMatch(t, /средняя 50%/, "доли ненадёжного признака не показаны");
  assert.match(t, /Жёсткость формы.*Точность разбора: верно 4 из 5 \(80%, нижняя граница \d+%\) — пока мало: нужно 20\./);
  assert.match(t, /мягкая 50%/, "пока мало отметок — доли показаны, но подписаны");
  assert.match(t, /Тоут|тоут 66,7%/);
  const none = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: null })));
  assert.doesNotMatch(none, /Точность разбора/);
  assert.match(none, /средняя 50%/, "без таблицы отметок экран как раньше");
  const empty = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: {} })));
  assert.match(empty, /Точность разбора: точность не измерена: размечено 0 из 20/);
});

test("Точность не загрузилась: доли показаны, но с предупреждением, что проверки по отметкам нет; у свободных полей строки про точность нет никогда", () => {
  const failed = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: undefined, accuracyFailed: true })));
  assert.match(failed, /Точность разбора не загрузилась: доли ниже показаны без проверки по отметкам человека/);
  assert.match(failed, /средняя 50%/);
  assert.doesNotMatch(failed, /Точность разбора: /, "строк про точность нет — их не из чего собрать");
  const ok = flat(renderToStaticMarkup(createElement(TraitsSection, { report: report(), accuracy: {} })));
  assert.doesNotMatch(ok, /Точность разбора не загрузилась/);
  const withColor = report();
  withColor.fields.push({ key: "color", label: "Цвет", visible: 60, notVisible: 0, values: [{ value: "чёрный", models: 30, share: 50, avgSourceShare: null, sources: 3 }], other: null });
  const t = flat(renderToStaticMarkup(createElement(TraitsSection, { report: withColor, accuracy: {} })));
  const colorCard = t.slice(t.indexOf("Цвет видно у"));
  assert.doesNotMatch(colorCard, /Точность разбора/, "цвет не размечается — «не измерена: 0 из 20» висело бы вечно");
});

test("Сводка точности: по признакам раздела, без цвета/деталей/фактуры; сколько моделей размечено", () => {
  const t = flat(renderToStaticMarkup(createElement(AccuracySummary, { direction: "bags", accuracy: { silhouette: fieldAccuracy(25, 0, 0) }, judgedModels: 14 })));
  assert.match(t, /Размечено моделей: 14\./);
  assert.match(flat(renderToStaticMarkup(createElement(AccuracySummary, { direction: "bags", accuracy: {}, judgedModels: 14, unjudgedModels: 40 }))), /ещё с неотмеченными признаками: 40/);
  const failed = flat(renderToStaticMarkup(createElement(AccuracySummary, { direction: "bags", accuracy: undefined, accuracyFailed: true, judgedModels: 3 })));
  assert.match(failed, /Точность не загрузилась — размечайте дальше/);
  assert.doesNotMatch(failed, /Силуэт —/);
  assert.match(t, /Силуэт — верно 25 из 25/);
  assert.match(t, /Пропорции — точность не измерена: размечено 0 из 20/);
  assert.doesNotMatch(t, /Цвет —|Фактура —/);
});

test("Миграция и роуты: таблица с ключом по версии вопроса, RLS и revoke; роут отметок под сессией модуля и проверяет вход; точность без кэша", () => {
  const sql = readFileSync(join(root, "supabase/migrations/202610050007_assortment_attribute_verdict.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.assortment_attribute_verdict/);
  assert.match(sql, /primary key \(source_id, model_key, field_key, prompt_version\)/);
  assert.match(sql, /verdict\s+text not null check \(verdict in \('ok', 'wrong', 'unclear'\)\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.assortment_attribute_verdict from anon, authenticated/);
  assert.doesNotMatch(sql, /\b(drop|truncate|delete from|alter table public\.assortment_model_attributes)\b/i, "ничего существующего не меняет");
  const route = readFileSync(join(root, "app/api/assortment-development/photo-traits/verdict/route.ts"), "utf8");
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /Неверная отметка/);
  assert.match(route, /judged_by|who = session/);
  const traits = readFileSync(join(root, "app/api/assortment-development/photo-traits/route.ts"), "utf8");
  assert.match(traits, /searchParams\.get\("accuracy"\) === "1"/);
  assert.match(traits, /searchParams\.get\("unjudged"\) === "1"/);
  assert.doesNotMatch(traits, /loadAccuracy\(db, direction\)\.catch/, "сбой чтения точности не превращается в null («таблицы нет»)");
  assert.match(traits, /if \(onlyUnjudged\) return NextResponse\.json\(\{ error: `Отметки не загрузились/, "разметка без прочитанных отметок невозможна — это ошибка, а не «примените миграцию»");
});
