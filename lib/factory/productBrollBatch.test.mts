// P0 Repeatable B-roll Machine fixtures. Run: npx tsx lib/factory/productBrollBatch.test.mts
import { buildProductBrollPlan } from "./productBrollBatch";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

{
  const plan = buildProductBrollPlan({ article: "COSRX-1", product: "COSRX serum", category: "cosmetics", count: 10, model: "kling" });
  eq(plan.length, 10, "builds requested 10 variants");
  ok(plan.every((v) => v.model === "kling"), "model is preserved");
  ok(plan.every((v) => v.duration === "5"), "P0 variants are 5s clips");
  ok(new Set(plan.map((v) => v.label)).size === plan.length, "variants have distinct labels");
  ok(plan.every((v) => /no captions, no text overlays/i.test(v.prompt)), "b-roll prompts forbid baked-in captions");
  ok(plan.every((v) => /stable, centered, intact/i.test(v.prompt)), "prompts include preservation close");
  ok(plan.some((v) => /cap, pump, printed text/i.test(v.prompt)), "cosmetics adds package-specific preservation");
}

{
  const plan = buildProductBrollPlan({ article: "SKU", product: "jacket", category: "apparel", count: 99, model: "seedance_fast" });
  eq(plan.length, 10, "current recipe caps to available moves before global max");
  ok(plan.every((v) => v.model === "seedance_fast"), "alternate model is preserved");
  ok(plan.every((v) => /seams, zipper, hood/i.test(v.prompt)), "apparel adds garment-specific preservation");
}

{
  const plan = buildProductBrollPlan({ article: "TT04102", product: "green water blaster", category: "toy", recipe: "toy_action", count: 4 });
  eq(plan.length, 4, "toy_action builds requested variants");
  ok(plan.every((v) => /nozzle, trigger, tank/i.test(v.prompt)), "toy prompts preserve blaster parts");
  ok(plan.some((v) => /water burst|backyard|splash/i.test(v.prompt)), "toy_action uses summer action moves");
  ok(!plan.some((v) => /vanity|serum|cap and label/i.test(v.prompt)), "toy_action avoids skincare moves");
}

{
  const plan = buildProductBrollPlan({ article: "SKU", count: 0 });
  eq(plan.length, 10, "empty/zero count falls back to default 10");
}

// Ниша сумок: свой набор moves (лукбук), а не скинкейр-ритуал.
{
  const bagPlan = buildProductBrollPlan({ article: "CLR00716", product: "сумка кросс-боди", category: "bag", count: 3 });
  ok(bagPlan.length === 3, "bag plan builds");
  ok(bagPlan.some(v => /leather|hardware|strap|shoulder|turntable|flap|silhouette/i.test(v.prompt)), "bag moves are lookbook, not skincare");
  ok(!bagPlan.some(v => /vanity|dropper|skincare routine/i.test(v.prompt)), "bag plan drops skincare-only moves");
  const bagRecipe = buildProductBrollPlan({ article: "CLR00716", product: "сумка", recipe: "bag_lookbook", count: 2 });
  ok(bagRecipe.length === 2, "bag_lookbook recipe works");
}

console.log(`\nproductBrollBatch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
