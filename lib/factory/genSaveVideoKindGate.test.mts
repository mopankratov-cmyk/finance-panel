import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("app/api/factory/gen-save/route.ts", "utf8");

ok(/function isVideoResponse/.test(source), "gen-save validates fetched media before storing as video");
ok(/content-type/.test(source), "gen-save checks response content-type");
ok(/ct\.startsWith\("video\/"\)/.test(source), "video content-type is accepted");
ok(/!ct\.startsWith\("image\/"\)/.test(source), "image content-type is not accepted as video");
ok(/video_url не является видео/.test(source), "non-video video_url returns explicit error");
ok(/status: invalidMedia \? 415 : 502/.test(source), "non-video video_url uses 415 instead of storage failure");
ok(/\.eq\("disk", "gen"\)\.eq\("kind", "video"\)/.test(source), "gen-save GET counts only generated video rows");
ok(/looksLikeVideoUrl\(String\(r\.url/.test(source), "gen-save GET hides image URLs from video memory");

console.log("genSaveVideoKindGate: passed");
