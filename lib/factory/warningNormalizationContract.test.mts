import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const observability = readFileSync("lib/factory/observability.ts", "utf8");

ok(/export function normalizeWarningReason\(reason: string\): string/.test(observability), "observability exposes shared warning normalizer");
ok(/if \(lower\.startsWith\("otk below threshold:"\)\) return "OTK below threshold";/.test(observability), "OTK threshold warnings are bucketed into one canonical reason");
ok(/if \(lower\.startsWith\("gen-save warning:"\)\) return "gen-save warning";/.test(observability), "gen-save warnings are bucketed into one canonical reason");
ok(/if \(lower\.startsWith\("extractframes failed:"\)\) return "extractFrames failed";/.test(observability), "extractFrames warnings are canonicalized");
ok(/if \(lower\.startsWith\("video-critic unavailable:"\)\) return "video-critic unavailable";/.test(observability), "video-critic transport failures are canonicalized");
ok(/const key = normalizeWarningReason\(String\(w\)\);/.test(observability), "observability top warnings use normalized reasons");
ok(/const s = normalizeWarningReason\(reason\)\.toLowerCase\(\);/.test(observability), "warning categories are derived from normalized warnings");

console.log("warningNormalizationContract: passed");
