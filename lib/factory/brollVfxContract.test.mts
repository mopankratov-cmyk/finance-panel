// Contract test for VFX b-roll module (docs/factory-broll-vfx-creatives-tz.md).
// Run: npx tsx lib/factory/brollVfxContract.test.mts
import { ok, equal } from "node:assert/strict";
import {
  VFX_ARTICLES, TRACK_A_MATRIX, TRACK_B_PROMPTS, KLING_EFFECTS_ENDPOINT,
  buildTrackAPayload, buildTrackBPrompt, substituteProduct, planWave1, VFX_NEGATIVE,
} from "./brollVfx";

// Категории артикулов ИСПРАВЛЕНЫ (в §1 ТЗ был перепутан TT/YYS).
equal(VFX_ARTICLES.toy.filter((a) => a.article.startsWith("TT")).length, 4, "TT* (бластеры/винтовки) в toy, не в cosmetics");
equal(VFX_ARTICLES.cosmetics[0].article, "YYS0101", "YYS0101 (крем) в cosmetics, не в toy");
ok(VFX_ARTICLES.bag.every((a) => a.article.startsWith("CLR")), "все bag — CLR");
ok(VFX_ARTICLES.apparel.every((a) => a.article.startsWith("NV")), "все apparel — NV");
ok(/toy gun|water rifle/.test(VFX_ARTICLES.toy[0].product), "TT-дескриптор — водная игрушка, не serum bottle");
ok(/sunscreen|SPF/.test(VFX_ARTICLES.cosmetics[0].product), "YYS-дескриптор — крем, не blaster");
ok(VFX_ARTICLES.toy.find((a) => a.article === "TT04102")?.blocked, "TT04102 помечен blocked");

// 30 промптов трека B по 4 категориям.
const total = Object.values(TRACK_B_PROMPTS).reduce((n, arr) => n + arr.length, 0);
equal(total, 30, "30 motion-промптов всего");
equal(TRACK_B_PROMPTS.bag.length, 8, "8 bag"); equal(TRACK_B_PROMPTS.cosmetics.length, 8, "8 cosmetics");
equal(TRACK_B_PROMPTS.toy.length, 6, "6 toy"); equal(TRACK_B_PROMPTS.apparel.length, 8, "8 apparel");

// Формула: камера в начале, {PRODUCT} подставлен, честный финал где не size_distort.
const b = buildTrackBPrompt("bag", "leather-macro", "the taupe handbag");
ok(b.prompt.startsWith("Camera:"), "промпт начинается с камеры");
ok(b.prompt.includes("the taupe handbag") && !b.prompt.includes("{PRODUCT}"), "{PRODUCT} подставлен");
ok(/true size, shape and colors/.test(b.prompt), "честный финальный кадр добавлен");
ok(b.negative_prompt === VFX_NEGATIVE, "негатив-промпт проставлен");
// size_distort (гиганты/билборды) — честный финал НЕ добавляется (противоречил бы сцене).
const giant = buildTrackBPrompt("bag", "giant-street", "the taupe handbag");
ok(giant.size_distort && !/true size/.test(giant.prompt), "size_distort клип не получает honest-final клаузу");

// §3.3 toy: без отскоков/бросков (фейл-мод физики).
ok(!TRACK_B_PROMPTS.toy.some((p) => /bounce|throw|toss/i.test(p.motion)), "toy-промпты без bounce/throw");

// Трек A: effects-endpoint без промпта, deform-эффекты только toy.
equal(KLING_EFFECTS_ENDPOINT, "fal-ai/kling-video/v1.6/standard/effects", "правильный effects endpoint");
const pa = buildTrackAPayload("https://x/img.png", "bullet_time_360", "5");
ok(!("prompt" in pa) && pa.effect_scene === "bullet_time_360" && pa.duration === "5", "трек A payload без промпта");
// Жёсткие морф-эффекты (squish/jelly/felt/plush) — только toy; expansion — документированное
// исключение (мягче, cosmetics+toy как в §2).
const hardMorph = new Set(["squish", "jelly_squish", "jelly_press", "jelly_slice", "jelly_jiggle", "felt_felt", "plushcut", "pixelpixel"]);
ok(TRACK_A_MATRIX.filter((r) => hardMorph.has(r.effect)).every((r) => r.categories.every((c) => c === "toy")), "жёсткие морф-эффекты только для игрушек");

// planWave1: волна 1, дублей нет, представитель toy = TT (не YYS).
const { jobs, warnings } = planWave1();
ok(jobs.length >= 40 && jobs.length <= 50, "волна 1 ~45 клипов");
equal(new Set(jobs.map((j) => j.clip_id)).size, jobs.length, "clip_id уникальны");
ok(jobs.filter((j) => j.track === "B" && j.category === "toy").every((j) => j.article.startsWith("TT")), "toy-клипы на TT-артикул");
ok(warnings.some((w) => /волна 1/.test(w)), "есть предупреждение о бюджете/команде владельца");

console.log("brollVfxContract: passed");
