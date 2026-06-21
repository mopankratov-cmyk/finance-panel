// Resilient poller: resume a lipsync job by id, survive network blips, download when done.
// usage: ID=<lipsync_id> OUT=out/x.mp4 node scripts/creatify-poll.mjs
import fs from "fs";
for (const f of [".env.local"]) { try { for (const l of fs.readFileSync(f, "utf8").split("\n")) { const m = l.match(/^\s*(CREATIFY_API_ID|CREATIFY_API_KEY)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } } catch {} }
const H = {"X-API-ID": process.env.CREATIFY_API_ID, "X-API-KEY": process.env.CREATIFY_API_KEY};
const BASE = "https://api.creatify.ai/api";
const ID = process.env.ID;
const OUT = process.env.OUT || "out/actor.mp4";
if (!ID) { console.error("no ID"); process.exit(1); }
let url = "";
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 8000));
  try {
    const s = await fetch(`${BASE}/lipsyncs/${ID}/`, {headers: H});
    const j = await s.json();
    if (j.status === "done" && (j.video_output || j.output)) { url = j.video_output || j.output; break; }
    if (j.status === "failed" || j.status === "error") { console.error("failed:", j.failed_reason); process.exit(1); }
    console.log(`[${i}] ${j.status}`);
  } catch (e) { console.log(`[${i}] blip:`, String(e.cause?.code || e).slice(0, 40)); }
}
if (!url) { console.error("timeout"); process.exit(1); }
for (let t = 0; t < 6; t++) {
  try { const buf = Buffer.from(await (await fetch(url)).arrayBuffer()); fs.mkdirSync("out", {recursive: true}); fs.writeFileSync(OUT, buf); console.log("OK →", OUT, buf.length); process.exit(0); }
  catch (e) { console.log("dl retry", t); await new Promise((r) => setTimeout(r, 4000)); }
}
console.error("download failed"); process.exit(1);
