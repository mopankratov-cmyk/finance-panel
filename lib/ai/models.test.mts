import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./models.ts", import.meta.url), "utf8");

test("по умолчанию все вызовы Anthropic идут на Opus 5", () => {
  assert.match(source, /"claude-opus-5"/);
});

test("финансовое распознавание — на «Пользе» через POLZA_FINANCE_MODEL, без захардкоженных слагов", () => {
  for (const file of ["../loans/aiRecognition.ts", "../finance/bankStatementPdf.ts", "../opiu/paymentAnswerRecognition.ts"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /"(?:anthropic|openai|google)\/[^"]+"/i, `${file}: слаг модели задан строкой, а не POLZA_FINANCE_MODEL`);
    assert.doesNotMatch(text, /"claude-(?:sonnet|haiku|opus)-[0-9][^"]*"/, `${file}: модель задана строкой, а не POLZA_FINANCE_MODEL`);
    assert.match(text, /POLZA_FINANCE_MODEL/, `${file}: не использует общую константу POLZA_FINANCE_MODEL`);
  }
});

test("прямой вызов Anthropic (AI-агент) — через ANTHROPIC_MODEL, без захардкоженной модели", () => {
  for (const file of ["../agent/client.ts"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /"claude-(?:sonnet|haiku|opus)-[0-9][^"]*"/, `${file}: модель задана строкой, а не ANTHROPIC_MODEL`);
    assert.match(text, /ANTHROPIC_MODEL/, `${file}: не использует общую константу`);
  }
});
