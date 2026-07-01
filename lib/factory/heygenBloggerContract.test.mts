// HeyGen blogger control-plane contract. Run: npx tsx lib/factory/heygenBloggerContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

import {
  DEFAULT_BLOGGER_CONFIG,
  validateBloggerConfig,
  dimensionFor,
  describeMetrics,
  type BloggerConfig,
} from "./heygenBlogger";
import { applyBloggerPatch, configToHeygenPayloads, HEYGEN_BLOGGER_TOOL } from "./heygenAgentTool";

// ── 1. Единый источник правды (heygenBlogger.ts) ──
const registry = readFileSync("lib/factory/heygenBlogger.ts", "utf8");
ok(/export const METRIC_REGISTRY/.test(registry), "registry exports METRIC_REGISTRY");
ok(/validateBloggerConfig/.test(registry) && /describeMetrics/.test(registry), "registry exports validator + describeMetrics");
ok(/DEFAULT_BLOGGER_CONFIG/.test(registry) && /DEFAULT_LOOKS/.test(registry), "registry exports defaults + looks");
ok(/"existing_look"/.test(registry) && /"Young Adult"/.test(registry) && /"Woman"/.test(registry) && /"9:16"/.test(registry) && /"avatar_iv"/.test(registry) && /"Friendly"/.test(registry), "registry enums cover key UGC values");

// ── 2. Agent-tool (тот же источник) ──
const tool = readFileSync("lib/factory/heygenAgentTool.ts", "utf8");
ok(/HEYGEN_BLOGGER_TOOL/.test(tool), "agent tool descriptor exported");
ok(/applyBloggerPatch/.test(tool) && /configToHeygenPayloads/.test(tool), "agent tool exports patch + mapping");
ok(/\/v3\/avatars/.test(tool) && /\/v3\/videos/.test(tool), "mapping references verified HeyGen v3 endpoints");

// ── 3. Schema-driven панель (рендер из registry, не хардкод) ──
const studio = readFileSync("app/inferno/heygen-blogger/HeygenBloggerStudio.tsx", "utf8");
const page = readFileSync("app/inferno/heygen-blogger/page.tsx", "utf8");
ok(/"use client"/.test(studio), "studio is a client component");
ok(/describeMetrics\(\)/.test(studio) && /METRIC_GROUPS/.test(studio), "studio renders from the registry");
ok(/@\/lib\/factory\/heygenBlogger/.test(studio) && /@\/lib\/factory\/heygenAgentTool/.test(studio), "studio imports single source + agent tool");
ok(/\/api\/factory\/heygen-readiness\?live=1/.test(studio) && /\/api\/factory\/heygen-identity/.test(studio) && /\/api\/factory\/heygen-smoke/.test(studio), "studio wires to HeyGen sidecar routes");
ok(/connection\(\)/.test(page) && /force-dynamic/.test(page) && /HeygenBloggerStudio/.test(page), "route is dynamic and renders studio");

// ── 4. Spec doc has control-plane section ──
const spec = readFileSync("docs/factory-ugc-heygen-integration-spec.md", "utf8");
ok(/Control Plane/.test(spec) && /Metric Registry/.test(spec), "spec documents the control plane");

// ── 5. Runtime: валидация управляется реестром ──
ok(describeMetrics().length >= 25, "registry exposes the full metric set");

// default requires existing look + voice selection → invalid intentionally until operator picks blogger.
const dflt = validateBloggerConfig(DEFAULT_BLOGGER_CONFIG);
ok(!dflt.ok, "default config is intentionally incomplete (needs look + voice)");
ok(dflt.errors.some((e) => /avatarLookId/.test(e)) && dflt.errors.some((e) => /voiceId/.test(e)), "validator flags look + voice requirements");

// «готовый» конфиг проходит
const ready: BloggerConfig = applyBloggerPatch(DEFAULT_BLOGGER_CONFIG, {
  "identity.avatarLookId": "f20cdc89e0ec4b61bbe453d73019a997",
  "voice.voiceId": "37832e32d4f7475ab7a1cb0db8e5dd66",
}).config;
ok(validateBloggerConfig(ready).ok, "ready config (look + voice) validates");

// patch enum + отклонение мусора
const bad = applyBloggerPatch(DEFAULT_BLOGGER_CONFIG, { "identity.age": "Nope", "foo.bar": 1 });
ok(bad.rejected.some((r) => /foo\.bar/.test(r)), "unknown metric rejected");
ok(bad.errors.some((e) => /identity\.age/.test(e)), "bad enum value flagged by validator");

// корректный patch применяется
const patched = applyBloggerPatch(ready, { "render.aspectRatio": "16:9", "voice.speed": 1.2 });
ok(patched.config.render.aspectRatio === "16:9" && patched.config.voice.speed === 1.2, "valid patch applied");

// dimension + mapping
const dim = dimensionFor("9:16", "720p");
ok(dim.width === 720 && dim.height === 1280, "9:16 720p → 720x1280");
const payloads = configToHeygenPayloads(ready);
ok(payloads.identity.kind === "existing_look", "existing_look → bind existing look payload");
ok(payloads.video.endpoint.length > 0 && JSON.stringify(payloads.video.body).includes("dimension"), "video payload carries dimension");
ok(HEYGEN_BLOGGER_TOOL.name === "configure_heygen_blogger", "agent tool has stable name");

console.log("heygenBloggerContract: passed");
