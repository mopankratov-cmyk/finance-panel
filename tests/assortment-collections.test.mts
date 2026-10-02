import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  briefCsv,
  CollectionInputError,
  constructionKey,
  jacketGroups,
  monthPeriod,
  parseItemPatch,
  periodLabel,
  placementFor,
  planProgress,
  sameConstruction,
  seasonOptions,
  stripColorTail,
  type BriefSnapshot,
  type PlanItemLite,
} from "../lib/assortment/collections.ts";
import { isMissingAssortmentSchema, isMissingColumnError } from "../lib/assortment/errors.ts";

/**
 * Подборки и задание на образец (этап 1.3). «Пять расцветок — одна идея»,
 * честное «3 из 5» и задание без цен ломаются тихо.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const item = (partial: Partial<PlanItemLite>): PlanItemLite => ({ id: "i", referenceId: "r", slot: null, isReserve: false, brand: "Polène", title: "Boky - Textured Camel", ...partial });

test("Расцветки одной модели — одна конструкция; разные модели бренда — разные", () => {
  assert.equal(constructionKey({ brand: "Polène", title: "Boky - Textured Camel" }), constructionKey({ brand: "Polène", title: "Boky – Textured Black" }));
  assert.notEqual(constructionKey({ brand: "Polène", title: "Boky - Textured Camel" }), constructionKey({ brand: "Polène", title: "Numéro Neuf Mini - Camel" }));
  assert.notEqual(constructionKey({ brand: "Polène", title: "Boky" }), constructionKey({ brand: "JW PEI", title: "Boky" }));
  const items = [item({ id: "a", referenceId: "ra", slot: 1 })];
  assert.equal(sameConstruction(items, { brand: "Polène", title: "Boky - Smooth Black", referenceId: "rb" })?.id, "a");
  assert.equal(sameConstruction(items, { brand: "Polène", title: "Boky - Textured Camel", referenceId: "ra" }), null, "сама с собой не дубль");
});

test("План сумок: честное «N из 5», выбранный слот, резерв до трёх, дальше — некуда", () => {
  const items = [item({ id: "a", slot: 1 }), item({ id: "b", slot: 3 }), item({ id: "c", slot: 4 })];
  const progress = planProgress("bags_month", items);
  assert.equal(progress.label, "3 из 5");
  assert.deepEqual(progress.freeSlots, [2, 5]);
  assert.deepEqual(placementFor("bags_month", items, false), { slot: 2, isReserve: false });
  assert.deepEqual(placementFor("bags_month", items, false, 5), { slot: 5, isReserve: false });
  assert.deepEqual(placementFor("bags_month", items, false, 3), { slot: 2, isReserve: false }, "занятый слот не перетирается");
  const full = [1, 2, 3, 4, 5].map((slot) => item({ id: `m${slot}`, slot }));
  assert.deepEqual(placementFor("bags_month", full, false), { slot: null, isReserve: true });
  const reserves = [1, 2, 3].map((n) => item({ id: `r${n}`, isReserve: true }));
  assert.equal(placementFor("bags_month", [...full, ...reserves], false), null);
  assert.equal(planProgress("bags_month", [...full, reserves[0]]).label, "5 из 5 · резерв 1");
  assert.equal(planProgress("jackets_season", [item({}), item({})]).label, "2 модели");
});

test("Периоды: месяц для сумок, сезон для курток", () => {
  assert.equal(monthPeriod(new Date("2026-10-02T00:00:00Z"), 1), "2026-11");
  assert.equal(monthPeriod(new Date("2026-12-15T00:00:00Z"), 1), "2027-01");
  assert.equal(periodLabel("2026-11"), "ноябрь 2026");
  assert.equal(periodLabel("2027-SS"), "весна–лето 2027");
  assert.deepEqual(seasonOptions(new Date("2026-10-02T00:00:00Z")).map((s) => s.period), ["2027-SS", "2027-AW", "2028-SS"]);
  assert.deepEqual(seasonOptions(new Date("2026-02-02T00:00:00Z")).map((s) => s.period), ["2026-AW", "2027-SS", "2027-AW"]);
});

test("Задание: до трёх деталей, без цен даже в свободном тексте", () => {
  assert.deepEqual(parseItemPatch({ details: "ручка-узел\n\nмагнитный клапан;  двойное дно " }).details, ["ручка-узел", "магнитный клапан", "двойное дно"]);
  assert.throws(() => parseItemPatch({ details: ["a", "b", "c", "d"] }), CollectionInputError);
  assert.throws(() => parseItemPatch({ brief: { differences: "сделать дешевле, цена до 3000 ₽" } }), CollectionInputError);
  assert.throws(() => parseItemPatch({ nextStep: "закупить по 40 $" }), CollectionInputError);
  assert.deepEqual(parseItemPatch({ idea: "  мягкий хобо  ", nextStep: "" }), { idea: "мягкий хобо", nextStep: null });
  assert.deepEqual(parseItemPatch({ brief: { questions: "Чем укреплено дно?" } }).brief, { differences: "", questions: "Чем укреплено дно?", season_fit: "" });
});

const snapshot: BriefSnapshot = {
  collection: { id: "c", title: "Сумки · ноябрь 2026", direction: "bags", kind: "bags_month", period: "2026-11", responsible: "Мария", version: 2, savedAt: "2026-10-02T10:00:00Z", savedBy: "director@x" },
  items: [{
    referenceId: "r", position: "Модель 1", title: "Boky; \"Textured\"", brand: "Polène", article: "000296002", sourceUrl: "https://eng.polene-paris.com/products/boky",
    idea: "Мягкий хобо", details: ["ручка-узел", "клапан"], differences: "короче ремень", questions: "чем укреплено дно?", seasonFit: "весна",
    nextStep: "образец-референс", observed: ["Метка ритейлера: NEW"], missing: ["Независимые публикации — соцсети пока не подключены"], attributes: [],
  }],
};

test("CSV для Excel: BOM, «;», кавычки экранированы, колонок цены нет", () => {
  const csv = briefCsv(snapshot);
  assert.ok(csv.startsWith("﻿"));
  const [header, row] = csv.slice(1).trim().split("\r\n");
  assert.match(header, /"Отличия нашей модели \(идея разработки\)";"Вопросы к образцу"/);
  assert.doesNotMatch(header, /цен|стоим|price|маржа|бюджет/i);
  assert.match(row, /"Boky; ""Textured"""/);
  assert.equal(header.split(";").length, 13);
});

test("Доска курток: подтип → силуэт, «не указан» в конце", () => {
  const groups = jacketGroups([
    { id: 1, attributes: { subtype: "пуховик", length: "до бедра", volume: "объёмный" } },
    { id: 2, attributes: { subtype: null, length: null, volume: null } },
    { id: 3, attributes: { subtype: "бомбер", length: "короткий", volume: null } },
    { id: 4, attributes: { subtype: "пуховик", length: null, volume: null } },
  ]);
  assert.deepEqual(groups.map((g) => g.subtype), ["бомбер", "пуховик", "Подтип не указан"]);
  assert.deepEqual(groups[1].groups.map((g) => g.silhouette), ["до бедра · объёмный", "Силуэт не указан"]);
});

test("Нет колонки из поздней миграции ≠ нет таблиц модуля", () => {
  assert.equal(isMissingAssortmentSchema(new Error("column assortment_collection_items.brief does not exist")), false);
  assert.equal(isMissingAssortmentSchema(new Error('relation "public.assortment_collections" does not exist')), true);
  assert.equal(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'brief' column of 'assortment_collection_items' in the schema cache" }), true);
  assert.equal(isMissingColumnError({ code: "23505", message: "duplicate key" }), false);
});

test("Миграция задания не добавляет цен и экономики", () => {
  const sql = readFileSync(join(root, "supabase/migrations/202610020001_assortment_collection_brief.sql"), "utf8");
  const columns = [...sql.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(columns, ["brief", "responsible"]);
  for (const column of columns) assert.doesNotMatch(column, /price|cost|margin|currency|spp|moq|budget/i);
});

test("Расцветка ASOS «… in black» — та же конструкция; короткие названия не режем", () => {
  assert.equal(
    constructionKey({ brand: "Stradivarius", title: "Stradivarius Soft-touch bomber jacket in ecru" }),
    constructionKey({ brand: "Stradivarius", title: "Stradivarius Soft-touch bomber jacket in black" }),
  );
  assert.equal(stripColorTail("mango funnel neck bomber jacket in brown check"), "mango funnel neck bomber jacket");
  assert.equal(stripColorTail("bag in leather"), "bag in leather");
  assert.notEqual(
    constructionKey({ brand: "Stradivarius", title: "Stradivarius Oversize bomber jacket in khaki" }),
    constructionKey({ brand: "Stradivarius", title: "Stradivarius Soft-touch bomber jacket in black" }),
  );
});
