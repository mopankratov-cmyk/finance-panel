import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/import \{ isPrivateOrLocalUrl \} from "\.\/reelVariants";/.test(source), "buildReelProps uses shared private/local URL guard");
ok(/function hasUnsafeRenderUrl\(value: unknown\)/.test(source), "graphRun has recursive render URL guard");
ok(/function isRenderableUrl\(value: unknown\)/.test(source), "graphRun has renderable asset URL guard");
ok(/function isBundledRenderAsset\(value: string\): boolean/.test(source), "graphRun allows only explicit bundled assets as non-http render sources");
ok(/Array\.isArray\(value\)[\s\S]*value\.some\(hasUnsafeRenderUrl\)/.test(source), "guard scans arrays recursively");
ok(/Object\.values\(value as Record<string, unknown>\)\.some\(hasUnsafeRenderUrl\)/.test(source), "guard scans nested objects recursively");
ok(/if \(explicit && !hasUnsafeRenderUrl\(explicit\)\)/.test(source), "explicit ReelV5 props are used only when URLs are public");
ok(!/if \(explicit\) \{\s*const dur = Number\(explicit\["durationInFrames"\]\)/.test(source), "unsafe explicit ReelV5 props cannot bypass fallback builder");
ok(/\^\\\/\|\^public\\\/\|\^\[\^\\s\]\+\\\.\(mp4\|mov\|webm\|m4v\|png\|jpe\?g\|webp\|gif\|mp3\|wav\)/.test(source), "explicit props reject local media-like paths such as public/*.mp4");
ok(/assetMatchesArticle\(a\.url, article\) && isRenderableUrl\(a\.url\)/.test(source), "autoBind ignores localhost/private catalog assets");
ok(/unsafe local\/private render asset skipped/.test(source), "assemble skips unsafe localhost/private visual assets before render");
ok(/const actorNode = visualNodes\.find\([\s\S]*isRenderableUrl\(n\.url\)/.test(source), "ReelV5 actor spine can only come from renderable visual nodes");
ok(/const audioSrc = isRenderableUrl\(rawAudioSrc\) \? rawAudioSrc : undefined;/.test(source), "ReelV5 audio source skips localhost/private URLs");
ok(/const audioUrl = isRenderableUrl\(rawShotstackAudioUrl\) \? rawShotstackAudioUrl : undefined;/.test(source), "Shotstack audio source skips localhost/private URLs");
ok(source.includes('if (!/^https?:\\/\\//i.test(u)) return false;'), "non-http media paths no longer count as renderable remote assets");

console.log("reelPropsSafety: passed");
