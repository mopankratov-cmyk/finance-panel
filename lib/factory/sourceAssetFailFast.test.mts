import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/function missingSourceReason\(n: RunNode\): string \| null/.test(source), "graph-run defines a shared missing-source classifier");
ok(/function isRawWbSourceUrl\(value: unknown\): boolean/.test(source), "graph-run detects raw WB image URLs");
ok(/function isRenderReadySource\(value: unknown\): boolean/.test(source), "graph-run has a central render-ready source predicate");
ok(/host\.endsWith\("wbbasket\.ru"\)/.test(source) && /host\.endsWith\("wbstatic\.net"\)/.test(source), "raw WB hosts are not render-ready");
ok(/some\(isRenderReadySource\)/.test(source), "existing node sources are filtered through render-ready predicate");
ok(/нет prepared\/real источника товара; сначала запусти prepare-product/.test(source), "disk_real missing-source reason points to product prep");
ok(/нет source asset для \$\{t\} \(image_url\/asset_url\)/.test(source), "i2v missing-source reason is explicit");
ok(/submit blocked by missing source assets/.test(source), "submit step records a dedicated execution-log note for source starvation");
ok(/рецепт остановлен до генерации: нет исходников товара/.test(source), "submit step fails fast before paid generation when the recipe has no source assets");
ok(/asset_bind_needs_prepare_product/.test(source), "graph-run records WB-only/raw-source recipes as needing product prep");
ok(!/asset_bind_wb_runtime_fallback/.test(source), "graph-run no longer rescues paid generation with raw WB fallback");
ok(!/wbCardImageUrl\(card\.nm_id, "big"\)/.test(source), "graph-run does not inject deterministic WB image URLs into i2v");

console.log("sourceAssetFailFast: passed");
