import assert from "node:assert/strict";
import test from "node:test";
import { reviewAnswerState } from "../lib/wb/reviewAnswer";

test("WB answered review remains answered when API omits reply text", () => {
  assert.equal(reviewAnswerState({ isAnswered: true, answerText: null }), "answered-without-text");
  assert.equal(reviewAnswerState({ isAnswered: true, answerText: "   " }), "answered-without-text");
});

test("WB review answer text is authoritative", () => {
  assert.equal(reviewAnswerState({ isAnswered: true, answerText: "Спасибо!" }), "answered-with-text");
  assert.equal(reviewAnswerState({ isAnswered: false, answerText: "Спасибо!" }), "answered-with-text");
  assert.equal(reviewAnswerState({ isAnswered: false, answerText: null }), "unanswered");
});
