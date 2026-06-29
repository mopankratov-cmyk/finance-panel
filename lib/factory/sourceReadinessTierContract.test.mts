import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const readiness = readFileSync("lib/factory/sourceReadiness.ts", "utf8");
const batch = readFileSync("app/api/factory/batch/route.ts", "utf8");

ok(/export type SourceReadinessTier = "prepared" \| "real" \| "wb" \| "none"/.test(readiness), "source readiness exposes source quality tiers");
ok(/tier: SourceReadinessTier = \(canonical \|\| prepared\) \? "prepared" : \(realVideos \|\| realImages\) \? "real" : wbImages \? "wb" : "none"/.test(readiness), "canonical/prepared and real sources outrank raw WB");
ok(/ready: tier === "prepared" \|\| tier === "real"/.test(readiness), "WB-only sources are weak prep inputs, not render-ready sources");
ok(/loadSourceReadiness/.test(batch), "batch preflight loads source readiness detail");
ok(/sourceTierRank/.test(batch), "batch selection sorts source-ready drafts by source tier");
ok(/const requireStrongSource = b\.require_strong_source !== false;/.test(batch), "batch requires prepared/real sources by default");
ok(/strong_source_drafts/.test(batch) && /wb_only_drafts/.test(batch), "batch preflight reports strong versus WB-only sources");
ok(/type: "prepare_product"/.test(batch), "batch suggests source-prep when only WB sources are available");

console.log("sourceReadinessTierContract: passed");
