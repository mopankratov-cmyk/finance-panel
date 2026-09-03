import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./models.ts", import.meta.url), "utf8");

test("по умолчанию все вызовы Anthropic идут на Opus 5", () => {
  assert.match(source, /"claude-opus-5"/);
});

test("в коде не осталось захардкоженных моделей Anthropic мимо общей константы", () => {
  for (const file of ["../loans/aiRecognition.ts", "../finance/bankStatementPdf.ts", "../opiu/paymentAnswerRecognition.ts", "../agent/client.ts"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /"claude-(?:sonnet|haiku|opus)-[0-9][^"]*"/, `${file}: модель задана строкой, а не ANTHROPIC_MODEL`);
    assert.match(text, /ANTHROPIC_MODEL/, `${file}: не использует общую константу`);
  }
});
