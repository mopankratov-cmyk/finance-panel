import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/async function saveOurStorageVideoToCatalog/.test(source), "graph-run has a direct catalog fallback for already durable storage videos");
ok(/if \(!url \|\| !isOurStorage\(url\)\) return null;/.test(source), "direct catalog fallback only handles our Supabase storage URLs");
ok(/reason: "catalog_direct_our_storage"/.test(source), "direct catalog fallback logs generation history");
ok(/catalog_fallback: "direct_our_storage"/.test(source), "direct catalog fallback marks content_assets analysis");
ok(/if \(!catalogUrl && catalogError && isOurStorage\(url\)\)/.test(source), "bank calls direct fallback after gen-save errors");
ok(/catalogError = null;/.test(source), "successful direct fallback clears catalog error");

console.log("genSaveLoopFallback contract ok");
