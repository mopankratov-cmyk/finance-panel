import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/factory/voice-review/route.ts", "utf8");

assert.match(route, /event: "voice_review_selected"/, "POST records voice_review_selected signal");
assert.match(route, /\.eq\("event", "voice_review_selected"\)/, "GET reads voice_review_selected signals");
assert.match(route, /params->>batch_id/, "GET can filter by batch_id inside params");
assert.match(route, /selected_indexes/, "route preserves selected indexes");
assert.match(route, /selected_candidate_ids/, "route preserves selected candidate ids");
assert.match(route, /Cache-Control": "no-store"/, "route is no-store");

console.log("voiceReviewRoute contract ok");
