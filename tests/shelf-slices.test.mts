import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShelfExclusionSet,
  computeShelfSlices,
  isShelfBrandExcluded,
  markShelfRows,
  shelfDiffPct,
  type ShelfRow,
} from "../lib/shelf/slices";
import { parseShelfSnapshotPayload } from "../lib/shelf/ingest";

// Фикстура — реальный сбор автора наработок (ТЗ §5): артикул 786649863,
// наша цена 4630 ₽, бренд MSstyle, 30 позиций «Смотрите также», из них 18 —
// свой же бренд. Ожидаемые средние сверены с ТЗ: Топ-6 4922 ₽, Топ-12 4992 ₽.

const OUR_PRICE = 4630;
const row = (position: number, brand: string | null, price: number): ShelfRow =>
  ({ position, nmId: position * 1000, brand, price, img: null });

const FIXTURE: ShelfRow[] = [
  row(1, "MAXFAME", 4270), row(2, "MAXFAME", 4112), row(3, "MAXFAME", 4381),
  row(4, "MSstyle", 3889), row(5, "Oksana Bout", 5941), row(6, "LANN", 4833),
  row(7, null, 5997), row(8, "ayonx", 3971), row(9, "СЛОЁНО", 5693),
  row(10, "MOMNALI", 4498), row(11, "MSstyle", 4482), row(12, "MSstyle", 3675),
  row(13, "MOMNALI", 5026), row(14, "MSstyle", 5188), row(15, "MSstyle", 3892),
  row(16, "MSstyle", 3892), row(17, "MSstyle", 4626), row(18, "MSstyle", 4626),
  row(19, "MSstyle", 5188), row(20, "MSstyle", 3745), row(21, "MSstyle", 4892),
  row(22, "MSstyle", 3243), row(23, "MSstyle", 4748), row(24, "MSstyle", 4892),
  row(25, "MSstyle", 4748), row(26, "MSstyle", 4748), row(27, "СЛОЁНО", 5190),
  row(28, "MSstyle", 3243), row(29, "Zunelle", 5996), row(30, "MSstyle", 5044),
];

const EXCLUSIONS = buildShelfExclusionSet("MSstyle");

test("срезы на фикстуре ТЗ: средние совпадают, сдвиг по неисключённым работает", () => {
  const slices = computeShelfSlices(FIXTURE, OUR_PRICE, EXCLUSIONS);
  const byN = new Map(slices.map((slice) => [slice.n, slice]));

  const top6 = byN.get(6)!;
  assert.equal(top6.label, "Топ-6");
  // ТЗ: 4922 ₽ (точно 4922.33) — срез сдвинулся мимо MSstyle на позиции 4.
  assert.ok(Math.abs(top6.avgPrice! - 4922.33) < 0.01, `Топ-6 средняя ${top6.avgPrice}`);
  // «+» = конкуренты дороже нас (семантика свежего кода автора, не старого ТЗ).
  assert.ok(Math.abs(top6.diffPct! - 6.31) < 0.02, `Топ-6 разница ${top6.diffPct}`);

  const top12 = byN.get(12)!;
  assert.equal(top12.label, "Топ-12");
  assert.ok(Math.abs(top12.avgPrice! - 4992.33) < 0.01);

  const top30 = byN.get(30)!;
  // Неисключённых всего 12 — честная подпись вместо молчаливой подмены.
  assert.equal(top30.label, "Топ-30 (доступно 12 из 30)");
  assert.equal(top30.eligibleCount, 12);
  assert.ok(Math.abs(top30.avgPrice! - top12.avgPrice!) < 0.001);

  const top3 = byN.get(3)!;
  assert.ok(Math.abs(top3.avgPrice! - (4270 + 4112 + 4381) / 3) < 0.01);
});

test("«только свои товары» — явное состояние, а не пустота или ошибка", () => {
  const onlyOwn = FIXTURE.map((r) => ({ ...r, brand: "MSstyle" }));
  const slices = computeShelfSlices(onlyOwn, OUR_PRICE, EXCLUSIONS);
  for (const slice of slices) {
    assert.equal(slice.onlyOwn, true);
    assert.equal(slice.avgPrice, null);
    assert.equal(slice.diffPct, null);
    assert.equal(slice.note, "только свои товары");
  }
});

test("три пустоты не путаются: нет сбора / нет цен / только свои", () => {
  // Сбор без конкурентов вовсе — это про качество сбора, не про рынок.
  const noRows = computeShelfSlices([], OUR_PRICE, EXCLUSIONS);
  assert.equal(noRows[0].onlyOwn, false);
  assert.equal(noRows[0].note, "конкуренты в этом сборе не сняты");

  // Конкуренты есть, но цены не снялись — тоже не «только свои товары».
  const noPrices = computeShelfSlices(
    [{ ...row(1, "A", 0), price: null }, { ...row(2, "B", 0), price: null }],
    OUR_PRICE,
    EXCLUSIONS,
  );
  assert.equal(noPrices[0].onlyOwn, false);
  assert.equal(noPrices[0].note, "цены конкурентов не сняты");
});

test("наша цена не снята — средние есть, разница честно молчит", () => {
  const slices = computeShelfSlices(FIXTURE, null, EXCLUSIONS);
  const top6 = slices.find((slice) => slice.n === 6)!;
  assert.ok(top6.avgPrice! > 0);
  assert.equal(top6.diffPct, null);
  assert.match(top6.note ?? "", /цена не снята/);
});

test("исключение брендов: регистр и пробелы не важны, пустой бренд не исключается", () => {
  const set = buildShelfExclusionSet("MSstyle", ["  maxfame "], ["СЛОЁНО"]);
  assert.equal(isShelfBrandExcluded("msstyle", set), true);
  assert.equal(isShelfBrandExcluded("MAXFAME", set), true);
  assert.equal(isShelfBrandExcluded("слоёно", set), true);
  assert.equal(isShelfBrandExcluded(null, set), false);
  assert.equal(isShelfBrandExcluded("  ", set), false);
});

test("разметка строк сортирует по позиции и не теряет исключённых", () => {
  const marked = markShelfRows([FIXTURE[3], FIXTURE[0]], EXCLUSIONS);
  assert.deepEqual(marked.map((r) => r.position), [1, 4]);
  assert.deepEqual(marked.map((r) => r.excluded), [false, true]);
  assert.equal(marked.length, 2);
});

test("конкурент без цены не участвует в средней, но срез не ломает", () => {
  const rows = [row(1, "A", 100), { ...row(2, "B", 0), price: null }, row(3, "C", 300)];
  const slices = computeShelfSlices(rows, 200, buildShelfExclusionSet("наш"));
  const top3 = slices.find((slice) => slice.n === 3)!;
  assert.equal(top3.label, "Топ-3 (доступно 2 из 3)");
  assert.equal(top3.avgPrice, 200);
});

test("знак разницы: конкурент дороже нас — плюс", () => {
  assert.ok(shelfDiffPct(100, 110) > 0);
  assert.ok(shelfDiffPct(100, 90) < 0);
});

// --- Разбор снимка от сборщика ---

const VALID_PAYLOAD = {
  article: 786649863,
  collectedAt: "2026-08-10T15:50:00.000Z",
  our: { brand: "MSstyle", price: 4630, img: "https://x/1.webp", link: "https://wb/786649863" },
  competitors: [
    { position: 1, article: 753228368, brand: "MAXFAME", price: 4270, img: null },
    { position: 2, article: null, brand: null, price: null, img: null },
  ],
};

test("валидный снимок разбирается с сохранением null-цен", () => {
  const parsed = parseShelfSnapshotPayload(VALID_PAYLOAD);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.snapshot.nmId, 786649863);
  assert.equal(parsed.snapshot.our.price, 4630);
  assert.equal(parsed.snapshot.competitors.length, 2);
  assert.equal(parsed.snapshot.competitors[1].price, null);
});

test("мусор отклоняется словами, а не превращается в нули", () => {
  for (const [broken, pattern] of [
    [{ ...VALID_PAYLOAD, article: "abc" }, /article/],
    [{ ...VALID_PAYLOAD, collectedAt: "вчера" }, /collectedAt/],
    [{ ...VALID_PAYLOAD, our: { ...VALID_PAYLOAD.our, price: -5 } }, /our\.price/],
    [{ ...VALID_PAYLOAD, competitors: "не массив" }, /массив/],
    [{ ...VALID_PAYLOAD, competitors: [{ position: 0, price: 1 }] }, /position/],
    [{ ...VALID_PAYLOAD, competitors: [{ position: 1, price: 1 }, { position: 1, price: 2 }] }, /повторяется/],
    [{ ...VALID_PAYLOAD, competitors: Array.from({ length: 41 }, (_, i) => ({ position: i + 1, price: 1 })) }, /больше 40/],
    // Number(true)=1 и Number('')=0 — мусор не должен сходить за числа.
    [{ ...VALID_PAYLOAD, competitors: [{ position: true, price: 1 }] }, /position/],
    [{ ...VALID_PAYLOAD, our: { ...VALID_PAYLOAD.our, price: "" } }, /our\.price/],
  ] as const) {
    const parsed = parseShelfSnapshotPayload(broken);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, pattern);
  }
});
