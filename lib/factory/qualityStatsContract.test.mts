import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const stats = readFileSync("lib/factory/qualityStats.ts", "utf8");
const route = readFileSync("app/api/factory/quality/route.ts", "utf8");

ok(/export interface FactoryQualityStats/.test(stats), "quality stats exposes a stable contract");
ok(/produced_videos: produced\.length/.test(stats), "quality denominator is produced videos");
ok(/text_or_fallback_judged/.test(stats), "quality stats tracks text/fallback judged outputs separately");
ok(/status", "otk_pass"/.test(stats) || /text\(row\.status, 40\) === "otk_pass"/.test(stats), "quality pass requires otk_pass status");
ok(/num\(row\.otk_score\).*>= 7/.test(stats), "quality pass requires score >= 7");
ok(/basis !== "text" && basis !== "fallback" && basis !== "storyboard"/.test(stats), "quality pass excludes text/storyboard/fallback judging");
ok(/\.eq\("disk", "gen"\)\s*\.eq\("kind", "video"\)/.test(stats), "banked count only includes generated video rows");
ok(/headline_metric: "frames_grounded_otk_pass_rate"/.test(route), "quality route names the headline metric");
ok(/denominator: "produced_videos"/.test(route), "quality route names the denominator");

console.log("qualityStatsContract: passed");
