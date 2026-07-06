import { readFileSync } from "node:fs";
import { equal, ok } from "node:assert/strict";
import { buildPublicationPlan } from "./distribution";

const distribution = readFileSync("lib/factory/distribution.ts", "utf8");
const publishRoute = readFileSync("app/api/factory/publish/route.ts", "utf8");
const publications = readFileSync("lib/factory/publications.ts", "utf8");

ok(/export function buildPublicationPlan/.test(distribution), "distribution planner exists");
ok(/mode === "paid" && !adTokenPresent/.test(distribution), "paid publication is fail-closed without ad_token");
ok(/metricsPollable: status === "published" \|\| status === "scheduled"/.test(distribution), "planner exposes metrics pollability");
ok(/recordFactoryPublication\(db, \{/.test(publishRoute), "publish route writes publication ledger");
ok(/adTokenPresent: plan\.adTokenPresent/.test(publishRoute), "publish route stores ad token presence only");
ok(/readComplianceMetadata\(body\)/.test(publishRoute), "publish route preserves compliance metadata");
ok(/worker_box_id: text\(body\.worker_box_id, 120\)/.test(publishRoute), "publish route preserves worker box metadata");
ok(/publication_id: publication\.id/.test(publishRoute), "publish route returns publication id");
ok(/published_url: finalPublishedUrl/.test(publishRoute), "publish route links published_url");
ok(/external_post_id: finalExternalPostId/.test(publishRoute), "publish route links external post id");
ok(/ad_token_present: input\.adTokenPresent === true/.test(publications), "publication helper persists paid token marker");
ok(/ugc_job_id: ugcJobId/.test(publications) && /target_id: targetId/.test(publications), "publication helper links UGC job and target");
ok(/next_metrics_pull_at: existing\?\.next_metrics_pull_at \|\| nextMetricsPullAtIso\(\)/.test(publications), "published rows schedule the next metrics pull");
ok(/last_metrics_pull_at: existing\?\.last_metrics_pull_at \|\| null/.test(publications), "published rows keep last_metrics_pull_at null until a real poll");

const blockedPaid = buildPublicationPlan({ recipeId: 42, sourceUrl: "https://cdn/video.mp4", mode: "paid", platform: "TikTok" });
equal(blockedPaid.ok, false, "paid without ad token is blocked");
equal(blockedPaid.statusCode, 402, "paid token blocker is explicit");
equal(blockedPaid.error, "paid publication requires ad_token");

const paid = buildPublicationPlan({ recipeId: 42, sourceUrl: "https://cdn/video.mp4", mode: "paid", platform: "Reels", adToken: "ad-token-present" });
equal(paid.ok, true, "paid with ad token is allowed");
equal(paid.adTokenPresent, true, "paid plan stores only ad token marker");
equal(paid.platform, "instagram", "platform aliases normalize");

const manual = buildPublicationPlan({ recipeId: 7, publishedUrl: "https://t.me/post/1", mode: "manual", platform: "manual" });
equal(manual.ok, true, "manual publish can be recorded without ad token");
equal(manual.status, "published", "published_url implies published status");
equal(manual.metricsPollable, true, "published rows are metrics-pollable");

const scheduled = buildPublicationPlan({ recipeId: 8, sourceUrl: "https://cdn/video.mp4", scheduledAt: "2026-07-01T10:00:00Z" });
equal(scheduled.status, "scheduled", "scheduled_at implies scheduled status");
equal(scheduled.metricsPollable, true, "scheduled rows are metrics-pollable");

const wibes = buildPublicationPlan({ recipeId: 9, sourceUrl: "https://cdn/video.mp4", platform: "wibes" });
equal(wibes.platform, "wibes", "wibes stays explicit");

const vkClips = buildPublicationPlan({ recipeId: 10, sourceUrl: "https://cdn/video.mp4", platform: "vk_clips" });
equal(vkClips.platform, "vk_clips", "vk clips stays explicit");

console.log("distributionPublishContract: passed");
