import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const mediaStore = readFileSync("app/api/factory/media-store/route.ts", "utf8");
const videoFal = readFileSync("app/api/factory/video-fal/route.ts", "utf8");
const elevenlabs = readFileSync("lib/factory/elevenlabs.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(!/detail:/.test(mediaStore), "media-store no longer leaks legacy detail-only error shape");
ok(/error:"не удалось залить ни один слайд"/.test(mediaStore), "media-store exposes error field on upload failure");

ok(!/detail:/.test(videoFal), "video-fal uses the unified error field");
ok(/error:"FAL не принял задачу \(ключ\/баланс\/модель\)"/.test(videoFal), "video-fal surfaces submit failures through error");

ok(/let _elevenDefaultVoice: string \| null = null;/.test(elevenlabs), "elevenlabs memoizes default voice lookup");
ok(/if \(!vid\) \{ if \(_elevenDefaultVoice === null\) \{ const voices = await elevenListVoices\(\); _elevenDefaultVoice =/.test(elevenlabs), "elevenlabs only fetches voices once per process when voice id is missing");

ok(/const productFilterBtn=\(id,label\)=>el\("button"/.test(studio), "center product filters remain interactive buttons");
ok(/onclick:\(\)=>\{ S\.productFilter=id; render\(\); \}/.test(studio), "center product filters still mutate filter state");
ok(/...FMTS\.map\(\(\[k,l\]\)=>el\("span"/.test(studio), "library format chips remain interactive");
ok(/onclick:\(\)=>\{ S\.libFmt=k; screenLibrary\(root,true\); \}/.test(studio), "library format chips still drive local filtering");

console.log("qaRegressionContract: passed");
