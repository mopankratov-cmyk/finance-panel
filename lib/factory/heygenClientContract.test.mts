import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHeyGenCreateAvatarDryRun,
  buildHeyGenCreateVideoDryRun,
  heygenCreateAvatar,
  heygenCreateVideo,
  sanitizeHeyGenVideoStatus,
} from "./heygen";

{
  const dry = buildHeyGenCreateVideoDryRun({
    avatarLookId: "f20cdc89e0ec4b61bbe453d73019a997",
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
    script: "I did not plan to buy this, but it looked useful.",
    aspectRatio: "9:16",
  });
  equal(dry.endpoint, "/v3/videos", "video generation uses the verified v3 video endpoint");
  equal(dry.paid, true, "video generation is marked as paid");
  equal(dry.body.avatar_id, "f20cdc89e0ec4b61bbe453d73019a997", "video uses avatar look id as avatar_id");
  ok(!dry.warnings.some((warning) => /group id/i.test(warning)), "valid look id does not get a group warning");
}

{
  const dry = buildHeyGenCreateVideoDryRun({
    avatarLookId: "avatar_group_caroline_public",
    voiceId: "voice",
    script: "Short smoke.",
  });
  ok(dry.warnings.some((warning) => /look id/i.test(warning)), "group-looking ids are flagged before paid render");
}

{
  const dry = buildHeyGenCreateAvatarDryRun({
    name: "UGC Alina prompt draft",
    avatarType: "prompt",
    prompt: "Natural phone selfie creator, imperfect lighting, casual tone.",
  });
  equal(dry.endpoint, "/v3/avatars", "avatar creation uses v3 avatars endpoint");
  equal(dry.body.type, "prompt", "avatar type is preserved in v3 type field");
  ok(!("avatar_type" in dry.body), "avatar creation does not use legacy avatar_type field");
}

{
  const blockedVideo = await heygenCreateVideo({
    avatarLookId: "f20cdc89e0ec4b61bbe453d73019a997",
    voiceId: "37832e32d4f7475ab7a1cb0db8e5dd66",
    script: "Blocked by default.",
  });
  equal(blockedVideo.ok, false, "paid video call is blocked by default");
  equal("blocked" in blockedVideo && blockedVideo.blocked, true, "blocked video result is explicit");

  const blockedAvatar = await heygenCreateAvatar({
    name: "Blocked create",
    avatarType: "photo",
    imageUrl: "https://example.com/avatar.jpg",
  });
  equal(blockedAvatar.ok, false, "avatar creation is blocked by default");
  equal("blocked" in blockedAvatar && blockedAvatar.blocked, true, "blocked avatar result is explicit");
}

{
  const fixture = JSON.parse(readFileSync("lib/factory/__fixtures__/heygen/v3-video-status-completed.json", "utf8"));
  const sanitized = sanitizeHeyGenVideoStatus(fixture);
  equal(sanitized.status, "completed", "status is preserved");
  equal(sanitized.video_url_present, true, "video url presence is preserved");
  ok(!JSON.stringify(sanitized).includes("Signature="), "signed URL query is stripped");
  ok(!JSON.stringify(sanitized).includes("Key-Pair-Id"), "signed URL key-pair query is stripped");
}

{
  const client = readFileSync("lib/factory/heygen.ts", "utf8");
  ok(client.includes("/v3/avatars"), "client documents/uses v3 avatar catalog");
  ok(client.includes("/v3/avatars/looks"), "client has avatar looks endpoint");
  ok(client.includes("/v3/voices"), "client has voices endpoint");
  ok(client.includes("/v3/videos"), "client has v3 video endpoint");
  ok(!/graph-run/.test(client), "HeyGen sidecar does not call main factory graph-run");
}

{
  const route = readFileSync("app/api/factory/heygen-readiness/route.ts", "utf8");
  ok(/read-only catalog scan/.test(route), "readiness route is catalog-only by default");
  ok(/russian_voices/.test(route) && /language: "Russian"/.test(route), "readiness route exposes explicit Russian voices");
  ok(!/confirmPaid/.test(route), "readiness route cannot trigger paid generation");
}

console.log("heygenClientContract: passed");
