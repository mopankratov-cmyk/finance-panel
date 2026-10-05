import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccuracySummary, SampleCards, TraitsSection } from "../components/assortment/PhotoTraits.tsx";
import {
  ACCURACY_LOWER_MIN, ACCURACY_MIN_JUDGED, accuracyLabel, fieldAccuracy, hiddenReason, summarizeVerdicts, wilsonLower,
} from "../lib/assortment/attributeVerdicts.ts";
import { loadAccuracy, loadVerdicts, saveVerdict, VerdictInputError, VerdictTableMissingError } from "../lib/assortment/attributeVerdictsStore.ts";
import { PROMPT_VERSION, type PhotoTraitsReport } from "../lib/assortment/catalogAi.ts";
import { loadPhotoSamples, type PhotoSample } from "../lib/assortment/catalogAiStore.ts";

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
  assert.equal(fieldAccuracy(0, 0, 50).status, "unmeasured", "одни «не понять» — не измерено");
  assert.equal(fieldAccuracy(0, 0, 50).accuracy, null);
  const reliable = fieldAccuracy(25, 0, 3);
  assert.equal(reliable.status, "reliable");
  assert.ok((reliable.lower ?? 0) >= ACCURACY_LOWER_MIN);
  assert.equal(reliable.judged, 25, "«не понять» не в знаменателе");
  const unreliable = fieldAccuracy(17, 3, 0);
  assert.equal(unreliable.status, "unreliable");
  assert.equal(unreliable.accuracy, 0.85);
  assert.equal(fieldAccuracy(19, 1, 0).status, "unreliable", "95% при 20 отметках — нижняя граница всё ещё ниже 80%");
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
  assert.match(accuracyLabel(s.silhouette), /^верно 21 из 21 \(100%, нижняя граница \d+%\)$/);
  assert.match(accuracyLabel(s.proportions), /верно 5 из 10 \(50%, нижняя граница \d+%\) — пока мало: нужно 20/);
  assert.match(accuracyLabel(undefined), /точность не измерена: размечено 0 из 20/);
  assert.equal(hiddenReason(s.silhouette), null);
  assert.equal(hiddenReason(s.proportions), null, "пока мало отметок — доли не прячем, только честно подписываем");
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
  const all = (await loadPhotoSamples(db, "bags", { limit: 12, verdicts }))!;
  assert.equal(all.verdictsAvailable, true);
  assert.equal(all.judgedModels, 1);
  const a = all.samples.find((s) => s.modelKey === "S001|a")!;
  assert.deepEqual(a.verdicts, { silhouette: "wrong" });
  assert.equal(a.promptVersion, PROMPT_VERSION);
  const legacy = all.samples.find((s) => s.modelKey === "S001|c")!;
  assert.equal(legacy.promptVersion, "catalog-v1");
  assert.deepEqual(legacy.verdicts, {});
  const fresh = (await loadPhotoSamples(db, "bags", { limit: 12, verdicts, onlyUnjudged: true }))!;
  assert.ok(!fresh.samples.some((s) => s.modelKey === "S001|a"), "размеченная модель не предлагается снова");
  assert.equal(fresh.analyzed, 3, "разобрано — все, а не только неразмеченные");
  const noTable = (await loadPhotoSamples(db, "bags", { limit: 12, verdicts: null }))!;
  assert.equal(noTable.verdictsAvailable, false, "таблицы нет — кнопок не будет");
  const notAsked = (await loadPhotoSamples(db, "bags", { limit: 12 }))!;
  assert.equal(notAsked.verdictsAvailable, false);
});

// --- экран ---

const sample = (over: Partial<PhotoSample> = {}): PhotoSample => ({
  sourceId: "S001", sourceName: "Zara", title: "Bag a", imageUrl: null, model: "polza:m", takenAt: "2026-10-06T08:00:00Z",
  modelKey: "S001|a", promptVersion: PROMPT_VERSION, verdicts: {},
  attributes: [
    { key: "silhouette", label: "Силуэт", value: "тоут", notVisible: false, confidence: 0.9 },
    { key: "carry", label: "Способ ношения", value: null, notVisible: true, confidence: null },
  ], ...over,
});
const judging = { currentVersion: PROMPT_VERSION, busyKey: null, onVerdict: () => undefined };

test("Карточки в режиме разметки: кнопки «Верно / Неверно / Не понять» у написанного ИИ признака ≥40 px; у «не видно» и у прежней версии кнопок нет; без режима — как раньше", () => {
  const html = renderToStaticMarkup(createElement(SampleCards, { samples: [sample({ verdicts: { silhouette: "wrong" } })], judging }));
  assert.equal((html.match(/aria-pressed/g) ?? []).length, 3, "три кнопки, только у «Силуэта»");
  assert.match(html, /aria-label="Точность: Силуэт"/);
  assert.doesNotMatch(html, /aria-label="Точность: Способ ношения"/, "«не видно» отмечать нечего");
  assert.match(html, /aria-pressed="true"[^>]*>Неверно/, "текущая отметка подсвечена");
  assert.match(html, /h-10 min-w-10/);
  const legacy = renderToStaticMarkup(createElement(SampleCards, { samples: [sample({ promptVersion: "catalog-v1" })], judging }));
  assert.doesNotMatch(legacy, /aria-pressed/, "прежняя версия вопроса — отметка в точность не войдёт, кнопок нет (прячем, не серим)");
  assert.doesNotMatch(legacy, /disabled/);
  const plain = renderToStaticMarkup(createElement(SampleCards, { samples: [sample()] }));
  assert.doesNotMatch(plain, /aria-pressed/);
  const noKey = renderToStaticMarkup(createElement(SampleCards, { samples: [sample({ modelKey: undefined })], judging }));
  assert.doesNotMatch(noKey, /aria-pressed/);
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

test("Сводка точности: по признакам раздела, без цвета/деталей/фактуры; сколько моделей размечено", () => {
  const t = flat(renderToStaticMarkup(createElement(AccuracySummary, { direction: "bags", accuracy: { silhouette: fieldAccuracy(25, 0, 0) }, judgedModels: 14 })));
  assert.match(t, /Размечено моделей: 14\./);
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
});
