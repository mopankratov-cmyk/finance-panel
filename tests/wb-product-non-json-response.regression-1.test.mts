import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readApiResponse } from "../lib/http/readApiResponse";

test("WB product client converts Vercel plain-text platform errors into readable errors", async () => {
  const body = await readApiResponse<{ error?: string }>(
    new Response("An error occurred with this application.", {
      status: 504,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
    "Товары WB",
  );

  assert.match(body.error ?? "", /Товары WB вернул техническую ошибку HTTP 504/);
  assert.doesNotMatch(body.error ?? "", /Unexpected token/);
});

test("WB product page does not parse PIM responses with raw response.json", () => {
  const source = readFileSync(new URL("../components/wb/WbProductPage.tsx", import.meta.url), "utf8");
  assert.match(source, /readApiResponse<\{ ok\?: boolean; rows\?: PimRow\[]; notesReady\?: boolean; error\?: string \}>\(response, "Товары WB"\)/);
  assert.match(source, /readApiResponse<\{ data\?: \{ history\?: ProductNoteHistory\[] \}; error\?: string \}>\(response, "История товара WB"\)/);
  assert.match(source, /readApiResponse<\{ ok\?: boolean; note\?: Partial<PimRow>; error\?: string \}>\(response, "Сохранение товара WB"\)/);
  assert.doesNotMatch(source, /await response\.json\(\)/);
});
