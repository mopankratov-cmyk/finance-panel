import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  allowance, buildPhotoTraits, canonicalValue, catalogAiConfig, costUsd, DEFAULT_CATALOG_MODEL, estimatedCallUsd, fieldVocabulary,
  packAttributes, parseCatalogAnswer, pickCandidates, PROMPT_VERSION, resultKey, type CatalogHead, type ExistingResult, type TraitModel,
} from "../lib/assortment/catalogAi.ts";
import { isTransientVisionError, runCatalogAi, VisionStopError, type AskVision } from "../lib/assortment/catalogAiStore.ts";

/** Признаки каталога по фото: бюджет считается и соблюдается, очередь честная, отчёт не выдаёт оценку ИИ за факт. */

const NOW = Date.parse("2026-10-06T10:00:00Z");
const head = (sourceId: string, id: string, over: Partial<CatalogHead> = {}): CatalogHead => ({
  sourceId, sourceItemId: id, modelKey: `${sourceId}|${id}`, direction: "jackets", title: `Jacket ${id}`,
  imageUrls: [`https://img/${id}-1.jpg`, `https://img/${id}-2.jpg`], firstSeenAt: "2026-10-03T00:00:00Z", ...over,
});

test("Настройки: по умолчанию Haiku с известной ценой, бюджет $20 в неделю, 300 моделей в сутки; выключатель и своя цена", () => {
  const def = catalogAiConfig({});
  assert.equal(def.model, DEFAULT_CATALOG_MODEL);
  assert.deepEqual(def.price, { in: 1, out: 5 });
  assert.equal(def.weeklyBudgetUsd, 20);
  assert.equal(def.dailyLimit, 300);
  assert.equal(def.enabled, true);
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI: "off" }).enabled, false);
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "5", ASSORTMENT_CATALOG_AI_DAILY_LIMIT: "40" }).weeklyBudgetUsd, 5);
  const other = catalogAiConfig({ ASSORTMENT_CATALOG_AI_MODEL: "some-model" });
  assert.equal(other.price, null, "цены чужой модели не знаем — бюджет нечем считать");
  assert.deepEqual(catalogAiConfig({ ASSORTMENT_CATALOG_AI_MODEL: "some-model", ASSORTMENT_CATALOG_AI_PRICE_IN: "3", ASSORTMENT_CATALOG_AI_PRICE_OUT: "15" }).price, { in: 3, out: 15 });
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "-3" }).weeklyBudgetUsd, 20, "мусор в окружении — значение по умолчанию");
});

test("Стоимость вызова по токенам; запас на проверку бюджета до ответа", () => {
  assert.equal(costUsd({ inputTokens: 4000, outputTokens: 300 }, { in: 1, out: 5 }), 0.0055);
  assert.equal(costUsd({ inputTokens: 0, outputTokens: 0 }, { in: 1, out: 5 }), 0);
  assert.equal(estimatedCallUsd({ in: 1, out: 5 }), 0.007);
});

test("Разрешённый объём: бюджет недели, потолок суток и размер прогона — что меньше; нет цены — ноль", () => {
  const cfg = catalogAiConfig({});
  assert.deepEqual(allowance(cfg, 0, 0, 120), { models: 120, reason: "ok" });
  assert.deepEqual(allowance(cfg, 19.9, 0, 120), { models: 14, reason: "ok" }, "остаток $0,10 / 0,007 = 14 вызовов");
  assert.deepEqual(allowance(cfg, 20, 0, 120), { models: 0, reason: "budget" });
  assert.deepEqual(allowance(cfg, 25, 0, 120), { models: 0, reason: "budget" }, "перерасход не уходит в минус");
  assert.deepEqual(allowance(cfg, 0, 295, 120), { models: 5, reason: "ok" });
  assert.deepEqual(allowance(cfg, 0, 300, 120), { models: 0, reason: "daily_limit" });
  assert.equal(allowance({ ...cfg, price: null }, 0, 0, 120).models, 0);
});

test("Очередь: новые модели свежие первыми, потом повтор неудавшихся, последними — прежняя версия вопроса; без фото и «Рынок РФ» не берём", () => {
  const heads = [
    head("S1", "old", { firstSeenAt: "2026-09-01T00:00:00Z" }),
    head("S1", "new", { firstSeenAt: "2026-10-05T00:00:00Z" }),
    head("S1", "nophoto", { imageUrls: [] }),
    head("S128", "ru"),
    head("S2", "failed-ready"),
    head("S2", "failed-fresh"),
    head("S2", "failed-max"),
    head("S2", "done"),
    head("S2", "stale"),
    head("S1", "old", { firstSeenAt: "2026-09-01T00:00:00Z" }),
  ];
  const ex = (status: ExistingResult["status"], attempts: number, takenAt: string, promptVersion = PROMPT_VERSION): ExistingResult => ({ status, attempts, takenAt, promptVersion });
  const existing = new Map<string, ExistingResult>([
    [resultKey("S2", "S2|failed-ready"), ex("failed", 1, "2026-10-04T00:00:00Z")],
    [resultKey("S2", "S2|failed-fresh"), ex("failed", 1, "2026-10-06T05:00:00Z")],
    [resultKey("S2", "S2|failed-max"), ex("failed", 3, "2026-10-01T00:00:00Z")],
    [resultKey("S2", "S2|done"), ex("ok", 1, "2026-10-05T00:00:00Z")],
    [resultKey("S2", "S2|stale"), ex("ok", 1, "2026-10-05T00:00:00Z", "catalog-v0")],
  ]);
  const picked = pickCandidates(heads, existing, NOW, 100).map((h) => h.sourceItemId);
  assert.deepEqual(picked, ["new", "old", "failed-ready", "stale"]);
  assert.equal(pickCandidates(heads, existing, NOW, 2).length, 2, "лимит очереди");
  assert.deepEqual(pickCandidates(heads, existing, NOW, 0), []);
});

test("Ответ ИИ: признаки раздела, «не видно» помечено, деньги и чужие ключи отброшены, мусор — null", () => {
  const answer = '{"attributes":{"subtype":"Бомбер","length":"до бедра","hood":"не видно","color":"чёрный 3990 ₽","price":"99","pockets":"прорезные"},"confidence":{"subtype":0.9,"length":0.456,"hood":0.2}}';
  const stored = parseCatalogAnswer("jackets", answer)!;
  assert.deepEqual(stored.subtype, { v: "бомбер", c: 0.9 });
  assert.deepEqual(stored.length, { v: "до бедра", c: 0.46 });
  assert.deepEqual(stored.hood, { v: null, nv: true, c: 0.2 });
  assert.deepEqual(stored.pockets, { v: "прорезные" });
  assert.equal("color" in stored, false, "значение с деньгами не принимается");
  assert.equal("price" in stored, false, "чужой ключ не принимается");
  assert.equal(parseCatalogAnswer("jackets", "не знаю"), null);
  assert.equal(parseCatalogAnswer("bags", '{"attributes":{"subtype":"бомбер"}}'), null, "признак курток у сумки не принимается");
  assert.deepEqual(packAttributes({}), {});
});

test("Словарь значений из подсказок вопроса; значение приводится к слову словаря, остальное — «другое»", () => {
  assert.ok(fieldVocabulary("length").includes("до середины бедра"));
  assert.ok(fieldVocabulary("volume").includes("оверсайз"));
  assert.deepEqual(fieldVocabulary("color"), [], "цвет — свободный текст");
  assert.equal(canonicalValue("length", "до середины бедра"), "до середины бедра");
  assert.equal(canonicalValue("length", "ДО БЕДРА, чуть ниже"), "до бедра");
  assert.equal(canonicalValue("volume", "свободная, оверсайз"), "свободная", "названо два значения — берётся названное первым");
  assert.equal(canonicalValue("volume", "оверсайз, свободная"), "оверсайз");
  assert.equal(canonicalValue("volume", "странная"), "другое");
  assert.equal(canonicalValue("hood", "съемный"), "съёмный", "ё = е, показ — как в словаре");
  assert.equal(canonicalValue("volume", "ОВЕРСАЙЗ"), "оверсайз", "«й» не превращается в «и» в показе");
  assert.equal(canonicalValue("length", ""), "другое");
});

const tm = (sourceId: string, attributes: TraitModel["attributes"]): TraitModel => ({ sourceId, sourceName: sourceId, attributes });
const v = (value: string) => ({ v: value });
const nv = { v: null, nv: true as const };

test("Отчёт: «не видно» в долях не участвует, свободный текст не сводится, «другое» последним, нормировка по источникам", () => {
  const models: TraitModel[] = [
    // Большой источник S1: 20 моделей, 18 «до бедра», 2 «ниже колена»
    ...Array.from({ length: 18 }, () => tm("S1", { length: v("до бедра"), hood: v("есть"), color: v("чёрный") })),
    ...Array.from({ length: 2 }, () => tm("S1", { length: v("ниже колена"), hood: nv })),
    // Малый источник S2: 10 моделей, все «ниже колена»
    ...Array.from({ length: 10 }, () => tm("S2", { length: v("ниже колена"), volume: v("странная") })),
    // Источник S3: 3 модели — в среднюю не входит
    ...Array.from({ length: 3 }, () => tm("S3", { length: v("до бедра") })),
  ];
  const report = buildPhotoTraits("jackets", models, 100);
  assert.equal(report.analyzed, 33);
  assert.equal(report.coverage, 33);
  assert.equal(report.sourcesInAverage, 2, "S1 и S2 — от 10 моделей, S3 — нет");
  const length = report.fields.find((f) => f.key === "length")!;
  assert.equal(length.visible, 33);
  assert.equal(length.notVisible, 0);
  const hip = length.values.find((x) => x.value === "до бедра")!;
  assert.equal(hip.models, 21);
  assert.equal(hip.share, 63.6, "сырая доля 21 из 33");
  assert.equal(hip.avgSourceShare, 45, "(18/20 + 0/10) / 2 = 45%, а не 63,6%");
  const hood = report.fields.find((f) => f.key === "hood")!;
  assert.equal(hood.visible, 18);
  assert.equal(hood.notVisible, 2, "«не видно» считается отдельно и в доли не входит");
  assert.equal(hood.values[0].share, 100);
  assert.equal(report.fields.some((f) => f.key === "color"), false, "цвет — свободный текст, в доли не сводится");
  const volume = report.fields.find((f) => f.key === "volume")!;
  assert.deepEqual(volume.values, [], "по словарю ничего не нашлось");
  assert.equal(volume.other?.models, 10, "«странная» — в «другое», отдельно от списка значений");
  assert.equal(report.fields.some((f) => f.key === "subtype"), false, "признака нет ни у кого — поля нет");
});

// --- прогон: бюджет, суточный потолок, остановки ---

type Row = Record<string, unknown>;
interface FakeOpts {
  heads?: Row[]; results?: Row[]; usage?: Row[]; missing?: string[]; upsertFail?: boolean; usageWriteFail?: boolean;
  /** Соперник: вызывается один раз перед первым обновлением строки учёта — как параллельный прогон. */
  rival?: (usage: Row[]) => void;
}
function fakeDb(init: FakeOpts = {}) {
  const tables: Record<string, Row[]> = {
    assortment_catalog_heads: init.heads ?? [],
    assortment_model_attributes: init.results ?? [],
    assortment_ai_usage: init.usage ?? [],
    assortment_sources: [],
  };
  const writes: Array<{ table: string; row: Row }> = [];
  const keys: Record<string, string[]> = { assortment_model_attributes: ["source_id", "model_key"], assortment_ai_usage: ["day", "kind"] };
  const missingErr = (table: string) => ({ code: "42P01", message: `relation "public.${table}" does not exist` });
  let rivalDone = false;
  const db = {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      const state = { op: "select", values: {} as Row, returning: false };
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const isMissing = init.missing?.includes(table);
      const q: Record<string, unknown> = {
        select: () => { if (state.op === "update") state.returning = true; return q; },
        eq: (c: string, val: unknown) => { filters.push((r) => r[c] === val); return q; },
        gte: (c: string, val: unknown) => { filters.push((r) => String(r[c] ?? "") >= String(val)); return q; },
        is: (c: string, val: unknown) => { filters.push((r) => (r[c] ?? null) === val); return q; },
        order: () => q,
        range: (from: number, to: number) => Promise.resolve(isMissing ? { data: null, error: missingErr(table) } : { data: rows().slice(from, to + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        update: (values: Row) => { state.op = "update"; state.values = values; return q; },
        insert: (row: Row) => {
          if (init.usageWriteFail && table === "assortment_ai_usage" && row.kind === "catalog_attributes") return Promise.resolve({ error: { message: "db down" } });
          const k = keys[table];
          if (k && tables[table].some((r) => k.every((c) => r[c] === row[c]))) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          tables[table].push({ ...row });
          writes.push({ table, row });
          return Promise.resolve({ error: null });
        },
        upsert: (row: Row) => {
          if (init.upsertFail && table === "assortment_model_attributes") return Promise.resolve({ error: { message: "db down" } });
          const k = keys[table];
          const list = tables[table];
          const i = list.findIndex((r) => k.every((c) => r[c] === row[c]));
          if (i >= 0) list[i] = { ...list[i], ...row };
          else list.push(row);
          writes.push({ table, row });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (isMissing) return Promise.resolve({ data: null, error: missingErr(table) }).then(resolve);
          if (state.op === "update") {
            if (init.usageWriteFail && table === "assortment_ai_usage" && state.values.cost_usd !== undefined) return Promise.resolve({ data: null, error: { message: "db down" } }).then(resolve);
            if (init.rival && !rivalDone && table === "assortment_ai_usage") { rivalDone = true; init.rival(tables.assortment_ai_usage); }
            const hit = rows();
            for (const r of hit) Object.assign(r, state.values);
            writes.push({ table, row: state.values });
            return Promise.resolve({ data: state.returning ? hit.map((r) => ({ day: r.day })) : null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: rows(), error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as never, tables, writes };
}

const headRow = (sourceId: string, id: string, over: Row = {}): Row => ({
  source_id: sourceId, source_item_id: id, model_key: `${sourceId}|${id}`, direction: "jackets", title: `Jacket ${id}`,
  image_urls: [`https://img/${id}-1.jpg`, `https://img/${id}-2.jpg`], model_first_seen_at: "2026-10-03T00:00:00Z",
  model_last_seen_at: "2026-10-06T00:00:00Z", model_hidden_at: null, ...over,
});
const GOOD = '{"attributes":{"subtype":"бомбер","length":"до бедра"},"confidence":{"subtype":0.9}}';
const okAsk = (input = 4000, output = 300): AskVision => async () => ({ text: GOOD, inputTokens: input, outputTokens: output });
const clock = () => NOW;
const cfg = catalogAiConfig({});

test("Прогон: каждая модель — запись признаков и расход; бюджет и вызовы за день копятся в учёте", async () => {
  const { db, tables } = fakeDb({ heads: [headRow("S1", "a"), headRow("S1", "b"), headRow("S2", "c")] });
  const out = await runCatalogAi(db, { ask: okAsk(), config: cfg, now: clock, parallel: 2 });
  assert.equal(out.done, 3);
  assert.equal(out.failed, 0);
  assert.equal(out.costUsd, 0.0165, "3 × (4000·$1 + 300·$5)/1M");
  assert.equal(tables.assortment_model_attributes.length, 3);
  const saved = tables.assortment_model_attributes[0];
  assert.equal(saved.status, "ok");
  assert.equal(saved.prompt_version, PROMPT_VERSION);
  assert.equal(saved.model, DEFAULT_CATALOG_MODEL);
  assert.deepEqual(saved.attributes, { subtype: { v: "бомбер", c: 0.9 }, length: { v: "до бедра" } });
  assert.equal(saved.image_count, 2);
  const usage = tables.assortment_ai_usage.filter((r) => r.kind === "catalog_attributes");
  assert.equal(usage.length, 1, "учёт — одна строка на день (замок прогона лежит в строке другого назначения)");
  assert.equal(usage[0].day, "2026-10-06");
  assert.equal(usage[0].calls, 3);
  assert.equal(usage[0].cost_usd, 0.0165);
  assert.equal(usage[0].input_tokens, 12000);
  // повторный прогон ничего не берёт — всё разобрано
  const again = await runCatalogAi(db, { ask: okAsk(), config: cfg, now: clock });
  assert.equal(again.candidates, 0);
  assert.equal(again.done, 0);
});

test("Прогон: бюджет недели исчерпан — ни одного вызова ИИ; суточный потолок — то же", async () => {
  const heads = [headRow("S1", "a"), headRow("S1", "b")];
  let calls = 0;
  const ask: AskVision = async () => { calls += 1; return { text: GOOD, inputTokens: 4000, outputTokens: 300 }; };
  const spent = fakeDb({ heads, usage: [{ day: "2026-10-04", kind: "catalog_attributes", calls: 100, cost_usd: 20 }] });
  const a = await runCatalogAi(spent.db, { ask, config: cfg, now: clock });
  assert.equal(calls, 0);
  assert.equal(a.stoppedBy, "budget");
  assert.equal(a.allowReason, "budget");
  const limited = fakeDb({ heads, usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 300, cost_usd: 1.5 }] });
  const b = await runCatalogAi(limited.db, { ask, config: cfg, now: clock });
  assert.equal(calls, 0);
  assert.equal(b.allowReason, "daily_limit");
  // неделя считается по 7 дням: расход 8-дневной давности в бюджет не входит
  const old = fakeDb({ heads, usage: [{ day: "2026-09-28", kind: "catalog_attributes", calls: 999, cost_usd: 99 }] });
  const c = await runCatalogAi(old.db, { ask, config: cfg, now: clock });
  assert.equal(c.done, 2);
  assert.equal(calls, 2);
});

test("Прогон: бюджет проверяется ДО каждой пачки — перерасход не больше пачки", async () => {
  const heads = Array.from({ length: 10 }, (_, i) => headRow("S1", `m${i}`));
  const small = catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "0.03" });
  const { db } = fakeDb({ heads });
  const out = await runCatalogAi(db, { ask: okAsk(), config: small, now: clock, parallel: 3 });
  // Запас на вызов — $0,007, фактически $0,0055: пачка 3, затем по одному, пока остаток позволяет запас.
  assert.equal(out.done, 5);
  assert.ok(out.costUsd <= 0.03, "расход не выше бюджета недели");
  assert.equal(out.stoppedBy, "budget");
  assert.equal(heads.length - out.done, 5, "остальные ждут следующей недели");
});

test("Прогон: суточный потолок действует и внутри прогона, а расход других назначений в бюджет каталога не входит", async () => {
  const heads = Array.from({ length: 10 }, (_, i) => headRow("S1", `m${i}`));
  const daily = fakeDb({ heads });
  const out = await runCatalogAi(daily.db, { ask: okAsk(), config: catalogAiConfig({ ASSORTMENT_CATALOG_AI_DAILY_LIMIT: "4" }), now: clock, parallel: 2 });
  assert.equal(out.done, 4, "после четырёх вызовов за сутки — стоп, хотя бюджет недели почти не тронут");
  assert.equal(out.stoppedBy, "budget");
  const foreign = fakeDb({ heads: [headRow("S1", "a")], usage: [{ day: "2026-10-06", kind: "other_ai", calls: 999, cost_usd: 99 }] });
  const free = await runCatalogAi(foreign.db, { ask: okAsk(), config: cfg, now: clock });
  assert.equal(free.done, 1, "чужой расход (другое назначение) бюджет и потолок каталога не съедает");
});

test("Прогон: ключ, деньги или лимит Anthropic — остановка сразу; расход и записи неудач не теряются", async () => {
  for (const code of ["auth", "billing", "rate_limit"] as const) {
    const { db, tables } = fakeDb({ heads: [headRow("S1", "a"), headRow("S1", "b"), headRow("S1", "c"), headRow("S1", "d")] });
    let calls = 0;
    const ask: AskVision = async () => { calls += 1; throw new VisionStopError("нет денег", code); };
    const out = await runCatalogAi(db, { ask, config: cfg, now: clock, parallel: 2 });
    assert.equal(out.stoppedBy, code);
    assert.equal(calls, 2, `${code}: вторая пачка не начинается`);
    assert.equal(tables.assortment_model_attributes.length, 0, "остановка не помечает модели неудачными: они попадут в очередь снова");
  }
});

test("Прогон: фото не скачалось — пробуем по первому; совсем не вышло — неудача с попыткой, без расхода", async () => {
  const { db, tables } = fakeDb({ heads: [headRow("S1", "a"), headRow("S1", "b")] });
  const seen: number[] = [];
  const ask: AskVision = async (_d, urls) => {
    seen.push(urls.length);
    if (urls[0].includes("/b-")) throw new Error("Unable to download the file");
    if (urls.length === 2) throw new Error("Unable to download the second image");
    return { text: GOOD, inputTokens: 2000, outputTokens: 200 };
  };
  const out = await runCatalogAi(db, { ask, config: cfg, now: clock, parallel: 1 });
  assert.equal(out.done, 1, "a — по одному фото");
  assert.equal(out.failed, 1, "b — не вышло совсем");
  assert.deepEqual(seen, [2, 1, 2, 1], "сначала два фото, потом одно");
  const byKey = Object.fromEntries(tables.assortment_model_attributes.map((r) => [r.model_key, r]));
  assert.equal(byKey["S1|a"].status, "ok");
  assert.equal(byKey["S1|a"].image_count, 1, "число фото — сколько реально ушло в вызов (запасной вариант — одно), а не сколько у модели");
  assert.equal(byKey["S1|b"].status, "failed");
  assert.equal(byKey["S1|b"].attempts, 1);
  assert.match(String(byKey["S1|b"].last_error), /Unable to download/);
  assert.equal(byKey["S1|b"].cost_usd, 0);
  assert.equal(out.costUsd, 0.0030, "платим только за состоявшийся ответ: 2000·$1 + 200·$5");
  const usage = tables.assortment_ai_usage.find((r) => r.kind === "catalog_attributes")!;
  assert.deepEqual([usage.calls, usage.failed_calls], [2, 1]);
});

test("Прогон: ответ без признаков — неудача с расходом (токены потрачены); повторная попытка наращивает счётчик", async () => {
  const { db, tables } = fakeDb({ heads: [headRow("S1", "a")], results: [{ source_id: "S1", model_key: "S1|a", status: "failed", attempts: 1, prompt_version: PROMPT_VERSION, taken_at: "2026-10-04T00:00:00Z" }] });
  const ask: AskVision = async () => ({ text: "не вижу", inputTokens: 3000, outputTokens: 50 });
  const out = await runCatalogAi(db, { ask, config: cfg, now: clock });
  assert.equal(out.failed, 1);
  assert.equal(out.costUsd, 0.00325);
  const row = tables.assortment_model_attributes[0];
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 2);
  assert.match(String(row.last_error), /не разобрался/);
});

test("Временные сбои (перегрузка, 5xx, сеть) не тратят попытку модели: записи нет, модель остаётся в очереди", async () => {
  assert.equal(isTransientVisionError(Object.assign(new Error("Overloaded"), { status: 529 })), true);
  assert.equal(isTransientVisionError(Object.assign(new Error("x"), { status: 503 })), true);
  assert.equal(isTransientVisionError(new Error("Request timed out.")), true);
  assert.equal(isTransientVisionError(Object.assign(new Error("Connection error."), { name: "APIConnectionError" })), true);
  assert.equal(isTransientVisionError(Object.assign(new Error("Unable to download the file"), { status: 400 })), false, "битое фото — сбой модели, а не сети");
  assert.equal(isTransientVisionError(new Error("ответ не разобрался")), false);
  const { db, tables } = fakeDb({ heads: [headRow("S1", "a"), headRow("S1", "b")] });
  const ask: AskVision = async (_d, urls) => {
    if (urls[0].includes("/a-")) throw Object.assign(new Error("Overloaded"), { status: 529 });
    return { text: GOOD, inputTokens: 1000, outputTokens: 100 };
  };
  const out = await runCatalogAi(db, { ask, config: cfg, now: clock, parallel: 1 });
  assert.deepEqual([out.done, out.failed, out.transient], [1, 0, 1]);
  assert.deepEqual(tables.assortment_model_attributes.map((r) => r.model_key), ["S1|b"], "для «a» записи нет — следующий прогон возьмёт её снова");
  assert.equal(tables.assortment_ai_usage.find((r) => r.kind === "catalog_attributes")?.failed_calls, 1, "вызов в учёте есть");
  const next = await runCatalogAi(db, { ask: okAsk(), config: cfg, now: clock });
  assert.equal(next.done, 1, "«a» разобрана со второй попытки без потери счётчика попыток");
  assert.equal(tables.assortment_model_attributes.find((r) => r.model_key === "S1|a")?.attempts, 1);
});

test("Системный сбой: 12 моделей подряд без успеха (4 пачки) — стоп; мёртвые фото отдельных моделей и успех между ними — не стоп", async () => {
  const heads = Array.from({ length: 30 }, (_, i) => headRow("S1", `m${String(i).padStart(2, "0")}`, { model_first_seen_at: `2026-10-03T00:${String(59 - i).padStart(2, "0")}:00Z` }));
  const dead: AskVision = async () => { throw new Error("Unable to download the file"); };
  const a = await runCatalogAi(fakeDb({ heads }).db, { ask: dead, config: cfg, now: clock, parallel: 3 });
  assert.equal(a.stoppedBy, "errors");
  assert.equal(a.failed, 12, "четыре пачки по три — и стоп, а не тридцать пустых попыток");
  let n = 0;
  const flaky: AskVision = async () => { n += 1; if (n % 4 === 0) return { text: GOOD, inputTokens: 100, outputTokens: 10 }; throw new Error("Unable to download the file"); };
  const b = await runCatalogAi(fakeDb({ heads }).db, { ask: flaky, config: cfg, now: clock, parallel: 1 });
  assert.equal(b.stoppedBy, null, "успех раз в четыре модели — это плохие фото, а не сбой");
  assert.equal(b.done + b.failed, 30);
});

test("Неверное имя модели (config) останавливает прогон на первой же пачке", async () => {
  const { db, tables } = fakeDb({ heads: Array.from({ length: 9 }, (_, i) => headRow("S1", `m${i}`)) });
  let calls = 0;
  const ask: AskVision = async () => { calls += 1; throw new VisionStopError("модель не найдена", "config"); };
  const out = await runCatalogAi(db, { ask, config: cfg, now: clock, parallel: 3 });
  assert.equal(out.stoppedBy, "config");
  assert.equal(calls, 3);
  assert.equal(tables.assortment_model_attributes.length, 0, "попытки моделей не потрачены");
});

test("Прогон: выключен, нет цены модели, нет таблиц — молча пропускается; dryRun ничего не вызывает", async () => {
  let calls = 0;
  const ask: AskVision = async () => { calls += 1; return { text: GOOD, inputTokens: 1, outputTokens: 1 }; };
  const heads = [headRow("S1", "a")];
  assert.match((await runCatalogAi(fakeDb({ heads }).db, { ask, config: catalogAiConfig({ ASSORTMENT_CATALOG_AI: "off" }), now: clock })).skipped ?? "", /выключено/);
  assert.match((await runCatalogAi(fakeDb({ heads }).db, { ask, config: catalogAiConfig({ ASSORTMENT_CATALOG_AI_MODEL: "x" }), now: clock })).skipped ?? "", /нет цены модели/);
  assert.match((await runCatalogAi(fakeDb({ heads, missing: ["assortment_model_attributes"] }).db, { ask, config: cfg, now: clock })).skipped ?? "", /миграция 202610050005/);
  assert.match((await runCatalogAi(fakeDb({ heads, missing: ["assortment_catalog_heads"] }).db, { ask, config: cfg, now: clock })).skipped ?? "", /миграция 202610050002/);
  const dry = await runCatalogAi(fakeDb({ heads: [headRow("S1", "a"), headRow("S1", "b")] }).db, { ask, config: cfg, now: clock, dryRun: true });
  assert.deepEqual([dry.candidates, dry.allowed, dry.done], [2, 2, 0]);
  assert.equal(calls, 0);
});

test("Прогон: время — новую пачку после бюджета времени не начинаем", async () => {
  const heads = Array.from({ length: 12 }, (_, i) => headRow("S1", `m${i}`));
  const { db } = fakeDb({ heads });
  let t = 0;
  const ask: AskVision = async () => { t += 60_000; return { text: GOOD, inputTokens: 100, outputTokens: 10 }; };
  const out = await runCatalogAi(db, { ask, config: cfg, now: () => t, parallel: 1, startBudgetMs: 150_000 });
  assert.equal(out.stoppedBy, "time");
  assert.equal(out.done, 3, "старты на 0, 60 и 120 с; на 180-й поздно");
});

test("Крон: ровно один, GET, за секретом, запас по времени; ключ и таблицы не обязательны для сборки", () => {
  const root = join(import.meta.dirname, "..");
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-catalog-ai"), [{ path: "/api/sync/assortment-catalog-ai", schedule: "40 */2 * * *" }]);
  const route = readFileSync(join(root, "app/api/sync/assortment-catalog-ai/route.ts"), "utf8");
  assert.match(route, /export async function GET\(/);
  assert.match(route, /checkCronAuth/);
  assert.match(route, /ASSORTMENT_CATALOG_AI=off/);
  assert.match(route, /нет ключа Anthropic/);
});

// --- по независимому ревью ---

const usageOf = (tables: Record<string, Row[]>) => tables.assortment_ai_usage.find((r) => r.kind === "catalog_attributes");

test("Учёт расхода без потерь при гонке: параллельный писатель между чтением и записью — прибавляем заново, а не затираем", async () => {
  const day = "2026-10-06";
  const { db, tables } = fakeDb({
    heads: [headRow("S1", "a")],
    usage: [{ day, kind: "catalog_attributes", calls: 10, failed_calls: 0, input_tokens: 1000, output_tokens: 100, cost_usd: 0.1, updated_at: "2026-10-06T08:00:00.000Z" }],
    rival: (usage) => {
      const row = usage.find((r) => r.kind === "catalog_attributes")!;
      Object.assign(row, { calls: 15, cost_usd: 0.2, updated_at: "2026-10-06T09:59:59.000Z" });
    },
  });
  const out = await runCatalogAi(db, { ask: okAsk(), config: cfg, now: clock });
  assert.equal(out.done, 1);
  const row = usageOf(tables)!;
  assert.equal(row.calls, 16, "15 соперника + 1 наш: расход соперника не потерян");
  assert.equal(row.cost_usd, 0.2055, "0,2 + 0,0055");
});

test("Замок прогона: пока другой прогон идёт, второй ничего не платит; упавший прогон замок не держит дольше аренды", async () => {
  const heads = [headRow("S1", "a"), headRow("S1", "b")];
  let calls = 0;
  const ask: AskVision = async () => { calls += 1; return { text: GOOD, inputTokens: 100, outputTokens: 10 }; };
  const lockedNow = fakeDb({ heads, usage: [{ day: "2026-10-06", kind: "lock:catalog_attributes", updated_at: new Date(NOW - 60_000).toISOString() }] });
  const skipped = await runCatalogAi(lockedNow.db, { ask, config: cfg, now: clock });
  assert.match(skipped.skipped ?? "", /другой прогон/);
  assert.equal(calls, 0);
  const expired = fakeDb({ heads, usage: [{ day: "2026-10-06", kind: "lock:catalog_attributes", updated_at: new Date(NOW - 7 * 60_000).toISOString() }] });
  const taken = await runCatalogAi(expired.db, { ask, config: cfg, now: clock });
  assert.equal(taken.done, 2, "аренда истекла (6 минут) — замок берём");
  const lock = expired.tables.assortment_ai_usage.find((r) => r.kind === "lock:catalog_attributes")!;
  assert.equal(lock.updated_at, "1970-01-01T00:00:00.000Z", "после прогона замок снят");
  // два прогона одновременно по одной базе: платит один
  const shared = fakeDb({ heads: Array.from({ length: 6 }, (_, i) => headRow("S1", `m${i}`)) });
  let paid = 0;
  const slow: AskVision = async () => { paid += 1; await new Promise((r) => setTimeout(r, 5)); return { text: GOOD, inputTokens: 100, outputTokens: 10 }; };
  const [one, two] = await Promise.all([runCatalogAi(shared.db, { ask: slow, config: cfg, now: clock }), runCatalogAi(shared.db, { ask: slow, config: cfg, now: clock })]);
  assert.equal(paid, 6, "каждая модель оплачена один раз, а не дважды");
  assert.equal([one, two].filter((r) => r.skipped).length, 1);
});

test("Оплаченный ответ, который не записался, всё равно попадает в расход; сбой записи учёта останавливает прогон, а не роняет его", async () => {
  const unsaved = fakeDb({ heads: Array.from({ length: 6 }, (_, i) => headRow("S1", `m${i}`)), upsertFail: true });
  const out = await runCatalogAi(unsaved.db, { ask: okAsk(), config: cfg, now: clock, parallel: 3 });
  assert.equal(out.done, 0);
  assert.equal(out.failed, 6);
  assert.equal(out.costUsd, 0.033, "6 оплаченных ответов: расход виден, хотя результаты не легли");
  assert.equal(usageOf(unsaved.tables)?.cost_usd, 0.033, "и в учёте тоже");
  const noUsage = fakeDb({ heads: Array.from({ length: 9 }, (_, i) => headRow("S1", `m${i}`)), usageWriteFail: true });
  const stopped = await runCatalogAi(noUsage.db, { ask: okAsk(), config: cfg, now: clock, parallel: 3 });
  assert.equal(stopped.stoppedBy, "errors");
  assert.match(stopped.stopMessage ?? "", /расход не записался/);
  assert.equal(stopped.done, 3, "первая пачка оплачена и записана; вслепую дальше не платим");
  assert.equal(noUsage.tables.assortment_model_attributes.length, 3);
});

test("Пересбор по новой версии вопроса не затирает хороший результат неудачей: признаки остаются, отмечена попытка", async () => {
  const good = { source_id: "S1", model_key: "S1|a", direction: "jackets", status: "ok", attributes: { length: { v: "до бедра" } }, prompt_version: "catalog-v0", attempts: 1, taken_at: "2026-10-01T00:00:00Z" };
  const { db, tables } = fakeDb({ heads: [headRow("S1", "a")], results: [{ ...good }] });
  const dead: AskVision = async () => { throw new Error("Unable to download the file"); };
  const out = await runCatalogAi(db, { ask: dead, config: cfg, now: clock });
  assert.equal(out.failed, 1);
  const row = tables.assortment_model_attributes[0];
  assert.equal(row.status, "ok", "статус не испорчен");
  assert.deepEqual(row.attributes, { length: { v: "до бедра" } }, "признаки на месте");
  assert.match(String(row.last_error), /Unable to download/);
  assert.equal(row.attempts, 2);
  assert.equal(row.taken_at, new Date(NOW).toISOString(), "срок следующей попытки считается от неё");
  const again = await runCatalogAi(db, { ask: dead, config: cfg, now: clock });
  assert.equal(again.candidates, 0, "в тот же день повторно не берём");
  const good2 = await runCatalogAi(db, { ask: okAsk(), config: cfg, now: () => NOW + 25 * 3600 * 1000 });
  assert.equal(good2.done, 1);
  assert.equal(tables.assortment_model_attributes[0].prompt_version, PROMPT_VERSION, "через сутки пересбор удался и обновил запись");
});

test("Ключ модели в базе не совпал с тем, что считает код (H&M до перезаписи ключей) — не разбираем: результат осиротел бы", async () => {
  const stable = headRow("S1", "a");
  const drifted = headRow("S007", "hm1", { title: "Mango jacket in brown", model_key: "S007|mango jacket" });
  const { db } = fakeDb({ heads: [stable, drifted] });
  let urls: string[] = [];
  const ask: AskVision = async (_d, u) => { urls = urls.concat(u); return { text: GOOD, inputTokens: 100, outputTokens: 10 }; };
  const out = await runCatalogAi(db, { ask, config: cfg, now: clock, dryRun: true });
  assert.equal(out.candidates, 1, "только S1; S007 ждёт, пока обход перепишет ключ");
  void urls;
});

test("Ноль в настройках — это ноль (стоп), а не «по умолчанию»; мусор и пустое — по умолчанию", () => {
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "0" }).weeklyBudgetUsd, 0);
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI_DAILY_LIMIT: "0" }).dailyLimit, 0);
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "" }).weeklyBudgetUsd, 20);
  assert.equal(catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "abc" }).weeklyBudgetUsd, 20);
  assert.deepEqual(allowance(catalogAiConfig({ ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD: "0" }), 0, 0, 120), { models: 0, reason: "budget" });
  assert.deepEqual(allowance(catalogAiConfig({ ASSORTMENT_CATALOG_AI_DAILY_LIMIT: "0" }), 0, 0, 120), { models: 0, reason: "daily_limit" });
  assert.deepEqual(allowance(cfg, 0, 0, 0), { models: 0, reason: "run_cap" });
});

test("Размер прогона — не нехватка бюджета: прогон, упёршийся в runCap, не сообщает «бюджет»", async () => {
  const { db } = fakeDb({ heads: Array.from({ length: 10 }, (_, i) => headRow("S1", `m${i}`)) });
  const out = await runCatalogAi(db, { ask: okAsk(), config: cfg, now: clock, runCap: 3, parallel: 3 });
  assert.equal(out.done, 3);
  assert.equal(out.stoppedBy, null, "следующий прогон продолжит");
});

test("Значения признаков: основа слова, отрицание и составные формулировки решаются по смыслу", () => {
  const c = canonicalValue;
  // отрицание не превращается в утверждение
  assert.equal(c("hood", "не съёмный"), "есть", "капюшон есть, просто не съёмный");
  assert.equal(c("hood", "без капюшона"), "нет");
  assert.equal(c("hood", "съёмный капюшон"), "съёмный");
  assert.equal(c("volume", "не приталенная"), "другое", "отрицание «приталенной» — не «приталенная»");
  assert.equal(c("proportions", "небольшая"), "другое", "«небольшая» — не «большая»");
  // падежи и формы слов
  assert.equal(c("closure", "на молнии"), "молния");
  assert.equal(c("closure", "с молнией"), "молния");
  assert.equal(c("volume", "прямой"), "прямая");
  assert.equal(c("sleeves", "прямые"), "прямые");
  // составные: больше слов — точнее; равные — по порядку в тексте
  assert.equal(c("pockets", "накладные на молнии"), "накладные", "названо первым");
  assert.equal(c("pockets", "на молнии"), "на молнии");
  assert.equal(c("length", "до середины бедра"), "до середины бедра");
  assert.equal(c("collar", "без воротника"), "без воротника");
  // «по горизонтали/вертикали» — два значения
  assert.ok(fieldVocabulary("proportions").includes("вытянутая по горизонтали"));
  assert.ok(fieldVocabulary("proportions").includes("вытянутая по вертикали"));
  assert.equal(c("proportions", "вытянутая по вертикали"), "вытянутая по вертикали");
  assert.equal(c("length", "до"), "другое", "короткое слово термина — только целиком");
});

test("Отчёт: «другое» не теряется при длинном списке значений; порядок — по показанной доле", () => {
  const vals = ["бомбер", "пуховик", "тренч", "парка", "ветровка", "пальто", "косуха", "жакет", "анорак"];
  const models: TraitModel[] = [
    ...vals.flatMap((v, i) => Array.from({ length: 10 - i }, () => tm("S1", { subtype: { v } }))),
    ...Array.from({ length: 60 }, () => tm("S1", { subtype: { v: "куртка с карманами" } })),
  ];
  const field = buildPhotoTraits("jackets", models, 200).fields.find((f) => f.key === "subtype")!;
  assert.equal(field.values.length, 8, "список значений обрезан до восьми");
  assert.equal(field.other?.models, 60, "«другое» — отдельно и не пропало вместе с обрезкой");
  assert.ok(field.other!.share > 50);
  assert.equal(field.values[0].value, "бомбер");
  assert.ok(field.values.every((v, i, all) => i === 0 || (all[i - 1].avgSourceShare ?? all[i - 1].share) >= (v.avgSourceShare ?? v.share)));
});
