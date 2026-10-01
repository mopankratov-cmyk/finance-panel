import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleDraft,
  buildLessons,
  lessonFor,
  lessonHighlights,
  reasonKey,
  reasonStats,
  type DraftCandidate,
  type RejectionRecord,
} from "../lib/assortment/learning.ts";

/**
 * Учёт отказов и черновик плана сумок (улучшение 7). Уроки должны опускать и
 * объяснять, а не прятать; черновик — не брать расцветки одной модели.
 */

const rec = (partial: Partial<RejectionRecord>): RejectionRecord => ({
  referenceId: "r1", direction: "bags", brand: "Polène", title: "Boky - Textured Camel", attributes: {}, reason: "shape", ...partial,
});

test("Причина из решения: отказ, замена, комментарий, «другое»; служебные пометки — не причина", () => {
  assert.equal(reasonKey("shape"), "shape");
  assert.equal(reasonKey("replaced:audience"), "audience");
  assert.equal(reasonKey("shape:слишком мягкая"), "shape");
  assert.equal(reasonKey("other:уже шьём похожую"), "other");
  assert.equal(reasonKey("возвращена в ленту"), null);
  assert.equal(reasonKey("убрана из подборки"), null);
  assert.equal(reasonKey(null), null);
});

test("Расцветка отклонённой модели опускается и подписывается; сама модель — нет", () => {
  const lessons = buildLessons([rec({})]);
  const sibling = lessonFor({ referenceId: "r2", direction: "bags", brand: "Polène", title: "Boky - Smooth Black", attributes: {} }, lessons, new Set(["r1"]));
  assert.ok(sibling && sibling.penalty >= 4);
  assert.match(sibling.note, /другая расцветка модели, которую отклонили \(форма\)/);
  assert.equal(lessonFor({ referenceId: "r1", direction: "bags", brand: "Polène", title: "Boky - Textured Camel", attributes: {} }, lessons, new Set(["r1"])), null);
  assert.equal(lessonFor({ referenceId: "r3", direction: "bags", brand: "JW PEI", title: "Mini Flap", attributes: {} }, lessons), null);
});

test("Силуэт после отказа «по форме» — урок для похожих; «слабые подтверждения» уроком не становятся", () => {
  const lessons = buildLessons([
    rec({ referenceId: "a", title: "Hobo One", attributes: { silhouette: "хобо" } }),
    rec({ referenceId: "b", brand: "JW PEI", title: "Hobo Two", attributes: { silhouette: "Хобо" } }),
    rec({ referenceId: "c", brand: "Songmont", title: "Tote", attributes: { silhouette: "тоут" }, reason: "weak_evidence" }),
  ]);
  const hit = lessonFor({ referenceId: "x", direction: "bags", brand: "Charles & Keith", title: "Crescent", attributes: { silhouette: "хобо" } }, lessons);
  assert.ok(hit);
  assert.equal(hit.penalty, 3);
  assert.match(hit.note, /силуэт «хобо» уже отклоняли по форме \(2 раза\)/);
  assert.equal(lessonFor({ referenceId: "y", direction: "bags", brand: "X", title: "Big Tote", attributes: { silhouette: "тоут" } }, lessons), null);
  assert.equal(lessonFor({ referenceId: "z", direction: "bags", brand: "X", title: "Q", attributes: { silhouette: "не видно" } }, lessons), null);
});

test("Бренд не подошёл аудитории дважды — мягкий урок; один раз — ещё нет", () => {
  const once = buildLessons([rec({ referenceId: "a", brand: "Songmont", title: "A", reason: "replaced:audience" })]);
  assert.equal(lessonFor({ referenceId: "n", direction: "bags", brand: "Songmont", title: "New", attributes: {} }, once), null);
  const twice = buildLessons([
    rec({ referenceId: "a", brand: "Songmont", title: "A", reason: "replaced:audience" }),
    rec({ referenceId: "b", brand: "songmont", title: "B", reason: "audience" }),
  ]);
  const hit = lessonFor({ referenceId: "n", direction: "bags", brand: "Songmont", title: "New", attributes: {} }, twice);
  assert.equal(hit?.penalty, 1);
  assert.match(hit?.note ?? "", /2 раза не подошли аудитории/);
  assert.ok(lessonHighlights(twice).some((line) => line.includes("не подошли аудитории")));
});

test("Сводка причин — по убыванию, с подписями", () => {
  const stats = reasonStats([rec({}), rec({ reason: "replaced:shape" }), rec({ reason: "audience" }), rec({ reason: "убрана из подборки" })]);
  assert.deepEqual(stats.map((s) => [s.reason, s.count]), [["shape", 2], ["audience", 1]]);
  assert.equal(stats[0].label, "Не нравится форма");
});

const cand = (partial: Partial<DraftCandidate>): DraftCandidate => ({ id: "c", title: "Model", brand: "B", score: 1, duplicateOf: null, lesson: null, attributes: {}, ...partial });

test("Черновик: разные конструкции, расцветки не берёт, честно пишет «N из 5»", () => {
  const draft = assembleDraft([
    cand({ id: "a", title: "Boky - Camel", brand: "Polène", score: 3 }),
    cand({ id: "b", title: "Boky - Black", brand: "Polène", score: 3 }),
    cand({ id: "c", title: "Numéro Neuf - Camel", brand: "Polène", score: 2 }),
    cand({ id: "d", title: "Mini Flap", brand: "JW PEI", score: 1 }),
    cand({ id: "e", title: "Tote", brand: "Songmont", score: 1, duplicateOf: "Tote - Brown" }),
  ], 5, 0);
  assert.deepEqual(draft.picks.map((p) => p.id), ["a", "c", "d"]);
  assert.equal(draft.mainFound, 3);
  assert.match(draft.summary, /Нашлось 3 из 5 разных конструкций\. Ещё 2 — расцветки уже взятых моделей\./);
});

test("Черновик: похожие на отклонённые — только если больше некого, с подписью; резерв после основных", () => {
  const draft = assembleDraft([
    cand({ id: "flag", title: "Hobo", score: 5, lesson: "Похожа на отклонённые: силуэт «хобо» уже отклоняли по форме" }),
    cand({ id: "a", title: "A", score: 2 }),
    cand({ id: "b", title: "B", score: 1 }),
  ], 2, 1);
  assert.deepEqual(draft.picks.map((p) => [p.id, p.place]), [["a", "main"], ["b", "main"], ["flag", "reserve"]]);
  assert.match(draft.picks[2].why, /^взята за неимением других/);
  assert.match(draft.summary, /Все 2 мест заняты/);
});

test("Черновик: при известных силуэте и способе ношения сначала разные сочетания", () => {
  const draft = assembleDraft([
    cand({ id: "a", title: "A", score: 3, attributes: { silhouette: "хобо", carry: "на плече" } }),
    cand({ id: "b", title: "B", score: 2, attributes: { silhouette: "хобо", carry: "на плече" } }),
    cand({ id: "c", title: "C", score: 1, attributes: { silhouette: "кросс-боди", carry: "через плечо" } }),
  ], 2, 0);
  assert.deepEqual(draft.picks.map((p) => p.id), ["a", "c"]);
});
