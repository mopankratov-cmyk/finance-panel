import fs from "node:fs";
import { normalizeRubricAxes, rubricAxesV2, weakestRubricAxis } from "./rubric";

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const oldAxes = normalizeRubricAxes({ hook: 4, retention: 3, native: 2, brand: 5, cta: 4 });
ok(oldAxes.native === 2 && oldAxes.brand === 5 && oldAxes.cta === 4, "old rubric axes remain compatible");

const v2 = normalizeRubricAxes({ hook: 4, scrollStop: 2, aiSlop: 5, productVisibility: 3, conversion: 4 });
ok(v2.retention === 2, "scrollStop maps to retention");
ok(v2.native === 1, "aiSlop inversely maps to native/de-ai");
ok(v2.brand === 3, "productVisibility maps to brand");
ok(v2.cta === 4, "conversion maps to cta");

const expanded = rubricAxesV2({ native: 2, brand: 4, cta: 3 });
ok(expanded.aiSlop === 4 && expanded.productVisibility === 4 && expanded.conversion === 3, "old axes expand to v2 diagnostics");

const culprit = weakestRubricAxis({ hook: 4, scrollStop: 5, aiSlop: 5, productVisibility: 4, conversion: 4 });
ok(culprit?.axis === "aiSlop", "high aiSlop can become regen culprit");

const graph = fs.readFileSync("lib/factory/graphRun.ts", "utf8");
ok(/weakestRubricAxis/.test(graph), "graph-run culprit picker uses rubric v2 mapping");
ok(/axis === "productVisibility"/.test(graph), "product visibility maps to product/proof node");

console.log("rubricV2Contract: passed");
