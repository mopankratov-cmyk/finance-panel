import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const sourcePrep = readFileSync("lib/factory/sourcePrep.ts", "utf8");
const route = readFileSync("app/api/factory/prepare-product/route.ts", "utf8");

ok(/import sharp from "sharp";/.test(sourcePrep), "source-prep fallback uses local image composition instead of FAL");
ok(/export async function prepareProductImageFallback/.test(sourcePrep), "source-prep exposes no-FAL fallback");
ok(/engine: "source-copy-fallback"/.test(sourcePrep), "fallback assets are traceable as fallback outputs");
ok(/disk: "prepared"/.test(sourcePrep), "fallback persists prepared source assets");
ok(/source_url: srcUrl/.test(sourcePrep), "fallback records original source url for dedupe");

ok(/import \{ prepareProductImage, prepareProductImageFallback \}/.test(route), "prepare-product route imports fallback");
ok(/body\.fallback_only === true \|\| body\.no_fal === true/.test(route), "prepare-product route supports explicit no-FAL mode");
ok(/if \(!fallbackOnly && !process\.env\.FAL_KEY\)/.test(route), "FAL key is required only for paid mode");
ok(/const prepare = fallbackOnly \? prepareProductImageFallback : prepareProductImage;/.test(route), "prepare-product switches implementation by mode");
ok(/mode: fallbackOnly \? "fallback" : "fal"/.test(route), "prepare-product response exposes selected mode");

console.log("sourcePrepFallbackContract: passed");
