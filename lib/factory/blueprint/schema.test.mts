import { ok, strictEqual } from "node:assert";
import { repairBlueprint, validateBlueprint } from "./schema";
import { compileBlueprint } from "./compile";

const blueprint = {
  sku_id: "COSRX001",
  lane: "product",
  format: "reel_9x16",
  duration_s: 12,
  hook: { text: "Этот крем проверяют не по отзывам", source: "strong_prompt", locked: true },
  beats: [
    { t: 0, shot: "Product appears on clean bathroom shelf", ref: { kind: "canonical", url: "https://cdn/prepared/COSRX001/frame.png" }, motion: "slow push-in" },
    { t: 6, shot: "Texture proof close-up", ref: { kind: "canonical", url: "https://cdn/prepared/COSRX001/frame.png" }, motion: "gentle macro tilt" },
  ],
  captions: [{ t: 0, text: "Смотри текстуру" }],
  cta: { text: "Артикул в профиле", t: 11 },
};

const valid = validateBlueprint(blueprint);
ok(valid.ok, "valid blueprint passes");
strictEqual(valid.blueprint.hook.locked, true, "hook remains locked");

const compiled = compileBlueprint(valid.blueprint);
strictEqual(compiled.nodes.length, 2, "beats compile to nodes");
strictEqual(compiled.nodes[0].asset_url, "https://cdn/prepared/COSRX001/frame.png", "canonical ref becomes asset_url");
ok(!compiled.nodes[0].prompt.includes("competitor"), "compiler does not inject competitor text");
strictEqual(compiled.graph_doc.hook_locked, true, "graph_doc records hook lock");

const bad = validateBlueprint({ ...blueprint, hook: { text: "x", source: "strong_prompt", locked: false } });
ok(!bad.ok, "unlocked hook is rejected");
strictEqual(repairBlueprint(JSON.stringify(blueprint))?.sku_id, "COSRX001", "repair accepts valid JSON string");
strictEqual(repairBlueprint("{not-json"), null, "repair returns null for malformed JSON");

console.log("blueprint schema/compile: passed");
