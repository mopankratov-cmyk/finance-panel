import fs from "node:fs";
import { buildProducerBlueprint } from "./producerBlueprint";

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const blueprint = buildProducerBlueprint({
  article: "12345",
  product_name: "SPF крем",
  hook: "Не покупай SPF, пока не увидишь тест через 8 часов",
  canonical_frame_url: "https://cdn.example.com/canonical.png",
  scenario: {
    duration_sec: 15,
    shots: [
      { t: "0-3с", visual: "нанести SPF на половину лица", onscreen: "8 часов теста" },
      { t: "3-8с", visual: "показать разницу на коже", onscreen: "одна сторона поплыла" },
    ],
  },
});
ok(blueprint.valid, "valid scenario produces render-safe blueprint");
ok(blueprint.blueprint?.hook.locked === true, "blueprint hook is locked");
ok(blueprint.blueprint?.beats[0]?.ref.kind === "canonical", "blueprint uses canonical source");

const noSource = buildProducerBlueprint({ article: "12345", hook: "Не покупай SPF, пока не увидишь тест через 8 часов", scenario: { shots: [{ visual: "test" }] } });
ok(!noSource.valid, "paid product blueprint requires canonical source");
ok(noSource.errors.includes("canonical_frame_url is required for paid product lane"), "missing canonical source is explicit");

const scenarioRoute = fs.readFileSync("app/api/factory/scenario/route.ts", "utf8");
const produceRoute = fs.readFileSync("app/api/factory/produce/route.ts", "utf8");
const quality = fs.readFileSync("lib/factory/scenarioQuality.ts", "utf8");
ok(/buildProducerBlueprint/.test(scenarioRoute), "scenario route returns blueprint");
ok(/buildProducerBlueprint/.test(produceRoute), "produce route returns blueprint");
ok(/pre_render_gate_reject/.test(quality), "scenario quality rejects invalid blueprint before paid render");

console.log("producerBlueprintContract: passed");
