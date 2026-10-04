import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAND_DEFAULTS, defaultProfile, fitFor, parseProfileInput, profileCompleteness, profileForms, profileFromRow,
} from "../lib/assortment/brandProfiles.ts";
import { loadProfiles, ProfileConflictError, ProfileTableMissingError, saveProfile } from "../lib/assortment/brandProfilesStore.ts";

/** Профиль бренда — решение владельца: пустое = «не решено», не «подходит». */

test("Три бренда: NORVIA и HEATON — два отдельных профиля курток, CLÉRIN — сумки; всё, кроме названия в WB, пусто", () => {
  assert.deepEqual(BRAND_DEFAULTS.map((p) => [p.brandKey, p.direction]), [["norvia", "jackets"], ["heaton", "jackets"], ["clerin", "bags"]]);
  for (const p of BRAND_DEFAULTS) {
    assert.equal(p.audience, null);
    assert.deepEqual([p.fitForms, p.avoidForms, p.seasons], [[], [], []]);
    assert.equal(p.status, "draft");
    assert.ok(p.wbBrandNames.length >= 1);
  }
  assert.deepEqual(defaultProfile("clerin")?.wbBrandNames, ["CLÉRIN", "CLERIN"]);
  assert.equal(defaultProfile("zara"), null);
});

test("Формы профиля — конкретные формы раздела, без общих «куртка» и «сумка»", () => {
  const jackets = profileForms("jackets").map((f) => f.key);
  assert.ok(jackets.includes("bomber") && jackets.includes("puffer"));
  assert.ok(!jackets.includes("jacket"));
  const bags = profileForms("bags").map((f) => f.key);
  assert.ok(bags.includes("tote") && !bags.includes("bag"));
});

test("Проверка тела: тексты чистятся, формы и сезоны только известные, версия обязательна", () => {
  const ok = parseProfileInput("jackets", { audience: "  Женщины   30–45 ", fitForms: ["bomber", "bomber", "puffer"], avoidForms: ["biker"], seasons: ["spring"], palette: "", confirmed: true, version: 1 });
  assert.ok("patch" in ok);
  assert.deepEqual(ok.patch, { audience: "Женщины 30–45", fitForms: ["bomber", "puffer"], avoidForms: ["biker"], seasons: ["spring"], palette: null, notes: null, sourceRef: null, confirmed: true, version: 1 });

  const bad = (input: Record<string, unknown>) => { const r = parseProfileInput("jackets", { version: 1, ...input }); return "error" in r ? r.error : null; };
  assert.match(bad({ fitForms: ["tote"] }) ?? "", /неизвестное значение/, "форма сумок в куртках");
  assert.match(bad({ fitForms: ["jacket"] }) ?? "", /неизвестное значение/, "общая «куртка» не форма профиля");
  assert.match(bad({ seasons: ["monsoon"] }) ?? "", /Сезоны/);
  assert.match(bad({ fitForms: ["bomber"], avoidForms: ["bomber"] }) ?? "", /и подходящей, и неподходящей/);
  assert.match(bad({ audience: "x".repeat(1001) }) ?? "", /не длиннее 1000/);
  assert.match(bad({ audience: 5 }) ?? "", /нужен текст/);
  assert.match(bad({ fitForms: "bomber" }) ?? "", /нужен список/);
  assert.match(bad({ version: undefined }) ?? "", /версию|версия/i);
  assert.equal(parseProfileInput("jackets", { version: 1, confirmed: "true" }).hasOwnProperty("patch"), true);
  const unconfirmed = parseProfileInput("jackets", { version: 1, confirmed: "true" });
  assert.ok("patch" in unconfirmed && unconfirmed.patch.confirmed === false, "подтверждение только настоящим true");
});

test("Полнота: что решено, чего не хватает; формы считаются решёнными, если хоть одна отмечена", () => {
  assert.deepEqual(profileCompleteness(BRAND_DEFAULTS[0]), { filled: 0, total: 4, missing: ["аудитория", "формы (подходят / не подходят)", "сезоны", "палитра"] });
  const part = profileCompleteness({ audience: "женщины", fitForms: [], avoidForms: ["biker"], seasons: [], palette: null });
  assert.equal(part.filled, 2);
  assert.deepEqual(part.missing, ["сезоны", "палитра"]);
});

test("Решение по форме: подходит / не подходит / не решено (пустой профиль не говорит «подходит»)", () => {
  const profile = { fitForms: ["bomber"], avoidForms: ["biker"] };
  assert.equal(fitFor(profile, "bomber"), "fit");
  assert.equal(fitFor(profile, "biker"), "avoid");
  assert.equal(fitFor(profile, "parka"), null);
  assert.equal(fitFor({ fitForms: [], avoidForms: [] }, "bomber"), null);
});

test("Строка базы → профиль; неизвестный бренд пропускается, пустое добирается из значений по умолчанию", () => {
  assert.equal(profileFromRow({ brand_key: "zara" }), null);
  const p = profileFromRow({ brand_key: "heaton", wb_brand_names: [], audience: "", fit_forms: ["windbreaker", 5], status: "confirmed", confirmed_at: "2026-10-05T10:00:00Z", version: 3 });
  assert.ok(p);
  assert.deepEqual(p.wbBrandNames, ["HEATON"], "названия в WB не обнуляются");
  assert.equal(p.audience, null);
  assert.deepEqual(p.fitForms, ["windbreaker"], "мусор в массиве отбрасывается");
  assert.equal(p.status, "confirmed");
  assert.equal(p.version, 3);
});

// --- хранилище ---

type Row = Record<string, unknown>;
function fakeDb(opts: { rows?: Row[]; missing?: boolean; insertError?: { code?: string; message: string }; updateMatches?: boolean } = {}) {
  const rows = opts.rows ?? [];
  const writes: Array<{ op: string; values: Row; filters: string[] }> = [];
  const missingError = { code: "42P01", message: 'relation "public.assortment_brand_profile" does not exist' };
  const db = {
    from: () => {
      const state = { op: "select", filters: [] as string[], values: {} as Row };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { state.filters.push(`${c}=${v}`); return q; },
        update: (values: Row) => { state.op = "update"; state.values = values; return q; },
        insert: (values: Row) => { state.op = "insert"; state.values = values; return q; },
        maybeSingle: async () => {
          if (opts.missing) return { data: null, error: missingError };
          if (state.op === "insert") {
            writes.push({ op: "insert", values: state.values, filters: [] });
            return opts.insertError ? { data: null, error: opts.insertError } : { data: { ...state.values }, error: null };
          }
          const key = state.filters.find((f) => f.startsWith("brand_key="))?.slice(10);
          return { data: rows.find((r) => r.brand_key === key) ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (opts.missing) return Promise.resolve({ data: null, error: missingError }).then(resolve);
          if (state.op === "update") {
            writes.push({ op: "update", values: state.values, filters: state.filters });
            return Promise.resolve({ data: opts.updateMatches === false ? [] : [{ brand_key: "norvia", ...state.values }], error: null }).then(resolve);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as never, writes };
}

const patch = { audience: "Женщины 30–45", fitForms: ["bomber"], avoidForms: [], seasons: ["autumn"], palette: null, notes: null, sourceRef: "брендбук", confirmed: true, version: 1 };

test("Чтение: нет таблицы — пустые черновики и persisted false; есть — строки поверх значений по умолчанию", async () => {
  const none = await loadProfiles(fakeDb({ missing: true }).db);
  assert.equal(none.persisted, false);
  assert.equal(none.profiles.length, 3);
  const some = await loadProfiles(fakeDb({ rows: [{ brand_key: "norvia", audience: "жен 30–45", version: 2 }] }).db);
  assert.equal(some.persisted, true);
  assert.equal(some.profiles[0].audience, "жен 30–45");
  assert.equal(some.profiles[1].audience, null, "heaton — пустой черновик");
});

test("Сохранение: версия совпала — update по версии, версия растёт, подтверждение пишет кто и когда", async () => {
  const { db, writes } = fakeDb({ rows: [{ brand_key: "norvia", version: 1 }] });
  const saved = await saveProfile(db, "norvia", patch, "owner@example.com", new Date("2026-10-05T10:00:00Z"));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].op, "update");
  assert.ok(writes[0].filters.includes("version=1"), "обновление только той версии, что читали");
  assert.equal(writes[0].values.version, 2);
  assert.equal(writes[0].values.status, "confirmed");
  assert.equal(writes[0].values.confirmed_by, "owner@example.com");
  assert.equal(saved.audience, "Женщины 30–45");
  const draft = fakeDb({ rows: [{ brand_key: "norvia", version: 1 }] });
  await saveProfile(draft.db, "norvia", { ...patch, confirmed: false }, "owner@example.com");
  assert.equal(draft.writes[0].values.status, "draft");
  assert.equal(draft.writes[0].values.confirmed_by, null, "черновик не помнит подтверждения");
});

test("Сохранение: чужая правка (версия не совпала или строку успели обновить) — конфликт, а не тихая перезапись", async () => {
  await assert.rejects(() => saveProfile(fakeDb({ rows: [{ brand_key: "norvia", version: 3 }] }).db, "norvia", patch, "x"), ProfileConflictError);
  await assert.rejects(() => saveProfile(fakeDb({ rows: [{ brand_key: "norvia", version: 1 }], updateMatches: false }).db, "norvia", patch, "x"), ProfileConflictError);
});

test("Сохранение: нет таблицы — понятная ошибка про миграцию; нет строки — создаётся; неизвестный бренд — отказ", async () => {
  await assert.rejects(() => saveProfile(fakeDb({ missing: true }).db, "norvia", patch, "x"), ProfileTableMissingError);
  const created = fakeDb({ rows: [] });
  await saveProfile(created.db, "heaton", { ...patch, version: 0 }, "x");
  assert.equal(created.writes[0].op, "insert");
  assert.equal(created.writes[0].values.version, 1);
  assert.equal(created.writes[0].values.display_name, "HEATON");
  await assert.rejects(() => saveProfile(fakeDb({ rows: [] }).db, "heaton", { ...patch, version: 4 }, "x"), ProfileConflictError, "строки нет, а версия не нулевая — чужая правка");
  await assert.rejects(() => saveProfile(fakeDb().db, "zara", patch, "x"), /Неизвестный бренд/);
  await assert.rejects(() => saveProfile(fakeDb({ rows: [], insertError: { code: "23505", message: "dup" } }).db, "heaton", { ...patch, version: 0 }, "x"), ProfileConflictError);
});
