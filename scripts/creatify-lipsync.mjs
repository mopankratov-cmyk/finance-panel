// Creatify lipsync: actor speaks our script FULL-SCREEN (no product card) — clean asset for the hybrid.
// Keys from .env.local. Run: node scripts/creatify-lipsync.mjs
import fs from "fs";
for (const file of [".env.local", ".env.vercel.pull"]) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*(CREATIFY_API_ID|CREATIFY_API_KEY)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const ID = process.env.CREATIFY_API_ID, KEY = process.env.CREATIFY_API_KEY;
if (!ID || !KEY) { console.error("нет ключей"); process.exit(1); }
const BASE = "https://api.creatify.ai/api";
const H = {"X-API-ID": ID, "X-API-KEY": KEY, "Content-Type": "application/json"};
const CREATOR = process.env.UGC_AVATAR || "0251876f-0da4-4c61-8320-8955d8be1f98"; // Diego
const SCRIPT =
  "Не показывай это детям. Это не игрушка — это водяной Узи. " +
  "Лупит очередями на восемь метров, светится, да ещё со звуком. " +
  "Купил, типа, детям — а теперь сам бегаю с ним по даче.";

const AUDIO_URL = process.env.AUDIO_URL || "";
const body = AUDIO_URL
  ? {audio: AUDIO_URL, creator: CREATOR, aspect_ratio: "9:16", model_version: "aurora_v1_fast"}
  : {text: SCRIPT, creator: CREATOR, aspect_ratio: "9:16", model_version: "aurora_v1_fast"};
console.log("mode:", AUDIO_URL ? "own-audio" : "tts");
const r = await fetch(BASE + "/lipsyncs/", {method: "POST", headers: H, body: JSON.stringify(body)});
const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
console.log("create:", r.status, JSON.stringify(j || t).slice(0, 220));
const id = j?.id; if (!id) process.exit(1);
let url = "";
for (let i = 0; i < 90; i++) {
  await new Promise((x) => setTimeout(x, 8000));
  try {
    const s = await fetch(`${BASE}/lipsyncs/${id}/`, {headers: H});
    const sj = await s.json().catch(() => ({}));
    if (sj.status === "done" && (sj.video_output || sj.output)) { url = sj.video_output || sj.output; break; }
    if (sj.status === "failed" || sj.status === "error") { console.error("failed:", sj.failed_reason); process.exit(1); }
    console.log(`[${i}] ${sj.status}`);
  } catch (e) { console.log(`[${i}] blip:`, String(e.cause?.code || e).slice(0, 40)); }
}
if (!url) { console.error("timeout"); process.exit(1); }
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
fs.mkdirSync("out", {recursive: true});
const outPath = process.env.UGC_OUT || "out/creatify-lipsync.mp4";
fs.writeFileSync(outPath, buf);
console.log("OK →", outPath, buf.length, "bytes");
