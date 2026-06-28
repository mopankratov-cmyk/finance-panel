import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../../proxy";

function matcherRegex() {
  const matcher = config.matcher?.[0];
  assert.equal(typeof matcher, "string");
  return new RegExp(`^${matcher}$`);
}

test("proxy matcher skips Next internals but protects app routes", () => {
  const regex = matcherRegex();

  assert.equal(
    regex.test("/_next/static/chunks/app.js"),
    false,
  );

  assert.equal(
    regex.test("/_next/image"),
    false,
  );

  assert.equal(
    regex.test("/_next/data/build-id/agent/reels-brain.json"),
    false,
  );

  assert.equal(
    regex.test("/agent"),
    true,
  );

  assert.equal(
    regex.test("/agent/reels-brain"),
    true,
  );
});
