// FAL media key contract.
// Run: npx tsx lib/factory/falMediaKeyContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const serverMedia = readFileSync("lib/factory/serverMedia.ts", "utf8");

ok(/function falMediaKey\(\): string/.test(serverMedia), "serverMedia has a shared FAL media key helper");
ok(/process\.env\.FAL_KEY \|\| process\.env\.FAL_BILLING_KEY/.test(serverMedia), "serverMedia accepts FAL_BILLING_KEY fallback");
ok(/export async function extractFrames[\s\S]*?const k = falMediaKey\(\);/.test(serverMedia), "extractFrames uses shared FAL media key");
ok(/export async function extractPosterUrl[\s\S]*?const k = falMediaKey\(\);/.test(serverMedia), "extractPosterUrl uses shared FAL media key");
ok(!/export async function extractFrames[\s\S]*?const k = process\.env\.FAL_KEY;/.test(serverMedia), "extractFrames no longer requires only FAL_KEY");

console.log("falMediaKeyContract: passed");
