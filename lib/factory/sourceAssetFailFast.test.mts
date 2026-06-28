import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/function missingSourceReason\(n: RunNode\): string \| null/.test(source), "graph-run defines a shared missing-source classifier");
ok(/нет реального видео и нет фото товара для i2v-фолбэка/.test(source), "disk_real missing-source reason is explicit");
ok(/нет source asset для \$\{t\} \(image_url\/asset_url\)/.test(source), "i2v missing-source reason is explicit");
ok(/submit blocked by missing source assets/.test(source), "submit step records a dedicated execution-log note for source starvation");
ok(/рецепт остановлен до генерации: нет исходников товара/.test(source), "submit step fails fast before paid generation when the recipe has no source assets");
ok(/fetchCabinetCards\(null\)/.test(source), "graph-run can query WB cards when local asset catalog is empty");
ok(/wbCardImageUrl\(card\.nm_id, "big"\)/.test(source), "graph-run falls back to deterministic WB product photo");
ok(/asset_bind_wb_runtime_fallback/.test(source), "graph-run logs when runtime WB fallback rescues an empty asset pool");

console.log("sourceAssetFailFast: passed");
