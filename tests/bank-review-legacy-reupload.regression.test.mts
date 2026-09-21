import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// PR #1167 (уже в main) сменил поиск сохранённых строк выписки с document_hash
// на operation_identity, но маркер __operation_identity: пишется только с
// PR #1164 — все строки очереди старше него сохранены без него. Раньше
// resolve при наличии идентичности НИКОГДА не откатывался на пару
// (document_hash, external_id), поэтому повторная загрузка любой выписки,
// импортированной до PR #1164, гарантированно давала 500 "Не все строки
// выписки удалось связать" и не проводила ни одной строки — живой баг в
// проде, не гипотетический (main уже задеплоен).

test("resolve сохранённой строки откатывается на (document_hash, external_id), если по идентичности не нашлось", async () => {
  const source = await readFile(new URL("../app/api/opiu/bank-review/route.ts", import.meta.url), "utf8");

  // Не должно быть старой ветки if/else, где отсутствие идентичности у
  // ИСХОДНОЙ строки — единственный путь к поиску по document_hash/external_id.
  assert.doesNotMatch(
    source,
    /const candidate = identity\s*\n\s*\? candidatesByIdentity\.get\(identity\)\s*\n\s*: candidates\.find/,
    "поиск по (document_hash, external_id) не должен быть недостижим, когда у исходной строки есть идентичность, а у сохранённой — нет",
  );
  assert.match(
    source,
    /const candidatesByExternalId = new Map\(candidates\.map/,
    "должна быть карта кандидатов по (document_hash, external_id) для отката",
  );
  assert.match(
    source,
    /\(identity \? candidatesByIdentity\.get\(identity\) : undefined\)\s*\n\s*\?\? candidatesByExternalId\.get/,
    "поиск по идентичности должен откатываться на (document_hash, external_id), а не заменять его целиком",
  );
});

test("строка, найденная только по старому ключу, дописывает себе маркер идентичности задним числом", async () => {
  const source = await readFile(new URL("../app/api/opiu/bank-review/route.ts", import.meta.url), "utf8");

  assert.match(source, /legacyIdentityBackfill/, "найденные по старому ключу строки должны обновлять reasons маркером идентичности");
  assert.match(
    source,
    /for \(const legacyRow of legacyIdentityBackfill\)/,
    "бэкфилл маркера должен реально выполняться, а не только собираться в массив",
  );
});
