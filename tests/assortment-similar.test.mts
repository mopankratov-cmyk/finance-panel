import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidence } from "../lib/assortment/evidence.ts";
import { EMBEDDING_DIM, EmbeddingInputError, MAX_DISTANCE, parseEmbeddingIngest, similarityPercent } from "../lib/assortment/similar.ts";

/**
 * Похожие силуэты по фото (этап 2). Сборщик на mini ходит без сессии — его
 * роуты обязаны проверять свой секрет, а прокси пропускать только их.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const MEDIA = "11111111-2222-4333-8444-555555555555";
const vector = (value = 0.01) => Array.from({ length: EMBEDDING_DIM }, () => value);

test("Посылка сборщика: 512 конечных чисел, вектор — в текст pgvector, сбои — с причиной", () => {
  const parsed = parseEmbeddingIngest({ model: "Xenova/clip-vit-base-patch32", items: [{ mediaId: MEDIA, embedding: vector(0.5) }], failed: [{ mediaId: MEDIA, error: "404" }] });
  assert.equal(parsed.items[0].embedding.slice(0, 9), "[0.5,0.5,");
  assert.equal(parsed.failed[0].error, "404");
  assert.throws(() => parseEmbeddingIngest({ model: "m", items: [{ mediaId: MEDIA, embedding: vector().slice(1) }] }), EmbeddingInputError);
  assert.throws(() => parseEmbeddingIngest({ model: "m", items: [{ mediaId: MEDIA, embedding: [...vector().slice(1), Number.NaN] }] }), EmbeddingInputError);
  assert.throws(() => parseEmbeddingIngest({ model: "m", items: [{ mediaId: "1; drop table", embedding: vector() }] }), EmbeddingInputError);
  assert.throws(() => parseEmbeddingIngest({ items: [] }), EmbeddingInputError);
});

test("Сходство в процентах и порог «похожей»", () => {
  assert.equal(similarityPercent(0.12), 88);
  assert.equal(similarityPercent(1.4), 0);
  assert.ok(MAX_DISTANCE > 0 && MAX_DISTANCE < 0.5);
});

test("Строка доказательств о похожих: не посчитано / не нашлось / N по фото", () => {
  const row = (n: number | null) => buildEvidence([], n).spread.find((r) => r.label === "Похожие модели у других брендов")!;
  assert.deepEqual([row(null).value, row(null).missing], ["не проверялось", true]);
  assert.deepEqual([row(0).value, row(0).missing], ["по фото не нашлось", true]);
  assert.deepEqual([row(3).value, row(3).missing], ["3 по фото", false]);
  assert.match(row(3).detail, /не доказательство одной модели/);
});

test("Роуты сборщика закрыты своим секретом, прокси пропускает только их", () => {
  for (const path of ["app/api/assortment-collector/queue/route.ts", "app/api/assortment-collector/embeddings/route.ts"]) {
    const source = read(path);
    assert.match(source, /checkAssortmentCollectorAuth\(request\)/, path);
    assert.doesNotMatch(source, /requireApiSession/, `${path}: сборщик безголовый`);
  }
  const auth = read("lib/assortment/collectorAuth.ts");
  assert.match(auth, /ASSORTMENT_COLLECTOR_SECRET/);
  assert.match(auth, /NODE_ENV === "production"/, "в проде без секретов — отказ");
  const proxy = read("proxy.ts");
  const publicBlock = proxy.slice(proxy.indexOf("PUBLIC_API"), proxy.indexOf("SELLER_READ_API_EXACT"));
  assert.match(publicBlock, /\{ prefix: "\/api\/assortment-collector\/queue", methods: \["GET"\] \}/);
  assert.match(publicBlock, /\{ prefix: "\/api\/assortment-collector\/embeddings", methods: \["POST"\] \}/);
  assert.equal((publicBlock.match(/\/api\/assortment-collector/g) ?? []).length, 2);
  assert.doesNotMatch(publicBlock, /\/api\/assortment-development/, "экраны модуля — только под сессией");
});

test("Миграции: без цен, закрыты от anon/authenticated, функция — sql и одна в файле", () => {
  const table = read("supabase/migrations/202610030001_assortment_media_embeddings.sql");
  assert.match(table, /extensions\.vector\(512\)/);
  assert.match(table, /revoke all on public\.assortment_media_embeddings from anon, authenticated/);
  assert.match(table, /security_invoker = true/);
  assert.doesNotMatch(table, /price|cost|margin|currency|budget/i);
  const fn = read("supabase/migrations/202610030002_assortment_similar_models.sql");
  assert.equal((fn.match(/create or replace function/g) ?? []).length, 1);
  assert.match(fn, /language sql/);
  assert.doesNotMatch(fn, /language plpgsql/);
  assert.match(fn, /revoke all on function public\.assortment_similar_models\(uuid, integer\) from public, anon, authenticated/);
});
