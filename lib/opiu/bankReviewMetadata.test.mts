import assert from "node:assert/strict";
import test from "node:test";
import { paymentCommentFromReasons, withPaymentComment } from "./bankReviewMetadata.ts";

test("комментарий платежа хранится в служебных метаданных очереди", () => {
  const reasons = withPaymentComment(["Правило", "__operation_identity:abc"], "Кому и за что");
  assert.equal(paymentCommentFromReasons(reasons), "Кому и за что");
  assert.deepEqual(withPaymentComment(reasons, ""), ["Правило", "__operation_identity:abc"]);
});
