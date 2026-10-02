import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_META_KEY, aiPrompt, mergeAiAttributes, parseAiAttributes } from "../lib/assortment/aiAttributes.ts";
import { ATTRIBUTE_FIELDS, attributeRows, type Attributes } from "../lib/assortment/attributes.ts";

/** Признаки по фото: только видимое, «оценка ИИ», ручное и опубликованное не трогает. */

const root = fileURLToPath(new URL("..", import.meta.url));
const NOW = "2026-10-03T09:00:00.000Z";

test("Подсказка ИИ: все признаки раздела из ТЗ, «не видно», без денег и состава", () => {
  const prompt = aiPrompt("bags");
  for (const field of ATTRIBUTE_FIELDS.bags) assert.match(prompt, new RegExp(`- ${field.key} —`));
  assert.match(prompt, /«не видно»/);
  assert.match(prompt, /замшевый вид/);
  assert.doesNotMatch(prompt, /- hood —/, "капюшона у сумок нет");
});

test("Разбор ответа: чужие ключи и деньги отбрасываются, «не видно» — отдельное состояние", () => {
  const parsed = parseAiAttributes("bags", 'Вот ответ: {"attributes": {"silhouette": "Хобо", "carry": "не видно", "price": "120 €", "texture": "кожа за 300 €", "hood": "есть"}, "confidence": {"silhouette": 0.92, "carry": 7}}');
  assert.deepEqual(parsed.silhouette, { value: "хобо", notVisible: false, confidence: 0.92 });
  assert.deepEqual(parsed.carry, { value: null, notVisible: true, confidence: 1 });
  assert.equal(parsed.texture, undefined, "деньги в признаках не пишем");
  assert.equal(parsed.price, undefined);
  assert.equal(parsed.hood, undefined, "у сумки нет капюшона");
  assert.deepEqual(parseAiAttributes("bags", "не JSON"), {});
});

test("Слияние: пустое заполняет, свою старую оценку обновляет, ручное и с сайта не трогает", () => {
  const existing: Attributes = {
    color: { value: "чёрный", origin: "manual", reviewer: "buyer@x", reviewed_at: NOW },
    category: { value: "Handbags", origin: "published" },
    silhouette: { value: "тоут", origin: "ai_estimate", model: "old" },
  };
  const { attributes, filled } = mergeAiAttributes(existing, {
    color: { value: "коричневый", notVisible: false, confidence: 0.8 },
    silhouette: { value: "хобо", notVisible: false, confidence: 0.9 },
    flap: { value: null, notVisible: true, confidence: null },
  }, "claude-opus-5", NOW);
  assert.equal(attributes.color.value, "чёрный", "ручное не перезаписано");
  assert.equal(attributes.silhouette.value, "хобо");
  assert.equal(attributes.silhouette.model, "claude-opus-5");
  assert.equal(attributes.flap.not_visible, true);
  assert.deepEqual(filled.sort(), ["flap", "silhouette"]);
  assert.equal(attributes[AI_META_KEY].model, "claude-opus-5");
  const rows = attributeRows("bags", attributes);
  assert.equal(rows.find((r) => r.key === "silhouette")?.origin, "оценка ИИ, уверенность 90%");
  assert.ok(!rows.some((r) => r.key === AI_META_KEY), "служебная отметка в таблицу не попадает");
});

test("Разбор раз в день с лимитом; кнопка — под сессией модуля", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-ai-attributes"), [{ path: "/api/sync/assortment-ai-attributes", schedule: "0 9 * * *" }]);
  const cron = readFileSync(join(root, "app/api/sync/assortment-ai-attributes/route.ts"), "utf8");
  assert.match(cron, /ASSORTMENT_AI_DAILY_LIMIT \|\| 20/);
  assert.match(cron, /export async function GET/);
  assert.match(readFileSync(join(root, "app/api/assortment-development/references/[id]/ai-attributes/route.ts"), "utf8"), /requireApiSession\(ASSORTMENT_ROLES\)/);
});
