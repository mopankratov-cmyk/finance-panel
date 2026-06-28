import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const diagnostics = readFileSync("lib/factory/qualityDiagnostics.ts", "utf8");
const route = readFileSync("app/api/factory/quality-diagnostics/route.ts", "utf8");

ok(/export interface FactoryQualityDiagnostics/.test(diagnostics), "quality diagnostics exposes a stable contract");
ok(/warning_counts/.test(diagnostics), "quality diagnostics groups warning reasons");
ok(/artifact_defects/.test(diagnostics), "quality diagnostics groups artifact defects");
ok(/memory_counts/.test(diagnostics), "quality diagnostics reports memory labels");
ok(/source_tiers/.test(diagnostics), "quality diagnostics reports source readiness tiers");
ok(/frames-grounded OTK pass-rate is 0/.test(diagnostics), "quality diagnostics flags zero pass-rate");
ok(/prepare_product for WB-only articles/.test(diagnostics), "quality diagnostics recommends source-prep for weak sources");
ok(/loadFactoryQualityDiagnostics/.test(route), "quality diagnostics route uses shared loader");
ok(/headline: "factory_quality_diagnostics"/.test(route), "quality diagnostics route names the payload");

console.log("qualityDiagnosticsContract: passed");
