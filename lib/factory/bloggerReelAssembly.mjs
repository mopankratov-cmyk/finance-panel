// Сборка полного рилса из клипов Drill Loop (вывод разбора 07-03: единичный клип добит,
// тест переезжает в ЛЕНТУ — фейк выдаёт ритм и однообразие, а не пальцы).
// Формат (монтаж-ресёрч 90/10 + reelFormats): лицо-хук ≤4с → тихие b-roll перебивки
// под ПРОДОЛЖАЮЩИЙСЯ голос хука → (опц.) возврат лица в конце.
// B-roll: Kling i2v из деглянц-стиллов ТОЙ ЖЕ сцены (identity/свет консистентны),
// прогоняется через анти-AI видеофильтр (Kling выдаёт слишком чистую картинку).
//
// npx tsx lib/factory/bloggerReelAssembly.mjs --plan <plan.json> --ffmpeg <bin> --confirm-paid true
// plan.json: { reels: [ { id, voice_src, face_cut_s, broll: [ { still_url|still_key, prompt, out } ],
//                         tail_face_s? } ] }
// Состояние (b-roll кэш) в docs/factory-blogger-reel-assembly-state.json (урок «/tmp — кладбище»).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildAntiAiVideoFilter } from "./antiAiPost.ts";

const STATE = "docs/factory-blogger-reel-assembly-state.json";
const OUT = "/tmp/ugc-factory-reels";
const KLING_I2V = "fal-ai/kling-video/v2.1/standard/image-to-video";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}
const boolArg = (name) => argValue(name, "false") === "true";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readDotenv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}
const ENV = { ...readDotenv(".env.production.local"), ...readDotenv(".env.local"), ...process.env };

const rawFetch = globalThis.fetch;
async function fetchR(url, init = {}, tries = 5) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await rawFetch(url, { ...init, signal: AbortSignal.timeout(45_000) }); }
    catch (e) { last = e; await sleep(1500 * i); }
  }
  throw last;
}
// скачивание видео: 45с не хватает (Kling ~4-5МБ с медленного CDN) — таймаут 240с
async function downloadBuf(url, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await rawFetch(url, { signal: AbortSignal.timeout(240_000) });
      if (!res.ok) throw new Error(`download ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { last = e; await sleep(3000 * i); }
  }
  throw last;
}
async function falQueue(model, body, maxWaitMs = 1_800_000) {
  const key = ENV.FAL_KEY || ENV.FAL_BILLING_KEY;
  const sub = await fetchR(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!sub.ok) throw new Error(`${model} submit ${sub.status}: ${(await sub.text()).slice(0, 200)}`);
  const { response_url } = await sub.json();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(8000);
    try {
      const st = await fetchR(`${response_url}/status`, { headers: { Authorization: `Key ${key}` } }, 3);
      if (st.ok) {
        const s = await st.json();
        if (s.status === "COMPLETED") break;
        if (s.status === "FAILED") throw new Error("FAILED");
      }
    } catch (e) { if (String(e.message) === "FAILED") throw e; }
  }
  const res = await fetchR(response_url, { headers: { Authorization: `Key ${key}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${model} result ${res.status}: ${text.slice(0, 250)}`);
  return JSON.parse(text);
}

function ffmpeg(bin, args) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(-300)}`);
}
function probeDuration(bin, file) {
  const r = spawnSync(bin, ["-i", file], { encoding: "utf8" });
  const m = (r.stderr || "").match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`no duration: ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { broll_cache: {}, reels: {} });
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));

async function main() {
  const planPath = argValue("--plan");
  const ffbin = argValue("--ffmpeg");
  if (!planPath || !ffbin) throw new Error("--plan и --ffmpeg обязательны");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  mkdirSync(OUT, { recursive: true });

  if (!boolArg("--confirm-paid")) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", reels: plan.reels.map((r) => ({ id: r.id, broll: r.broll.length })) }, null, 2));
    return;
  }
  const state = loadState();

  for (const reel of plan.reels) {
    try {
      // 1) b-roll: Kling i2v из стиллов (кэш по prompt+still)
      const brollFiles = [];
      for (const b of reel.broll) {
        const key = `${b.still_url}::${b.prompt}`;
        if (!state.broll_cache[key]) {
          console.log(`BROLL GEN ${reel.id}/${b.out}`);
          const res = await falQueue(KLING_I2V, {
            prompt: `${b.prompt}. Amateur handheld phone video, natural imperfect motion. No people appearing or disappearing, no morphing.`,
            image_url: b.still_url,
            duration: "5",
            negative_prompt: "blur, distort, morphing, extra hands, extra fingers, watermark, text",
          });
          const url = res.video?.url || res.video_url;
          if (!url) throw new Error(`kling no video: ${JSON.stringify(res).slice(0, 200)}`);
          state.broll_cache[key] = url;
          saveState(state);
        }
        const raw = `${OUT}/${reel.id}-${b.out}-raw.mp4`;
        const posted = `${OUT}/${reel.id}-${b.out}.mp4`;
        if (!existsSync(posted)) {
          writeFileSync(raw, await downloadBuf(state.broll_cache[key]));
          // анти-AI пост для b-roll (только видео — звук рилса живёт в голосовой дорожке хука)
          ffmpeg(ffbin, ["-y", "-i", raw, "-vf", buildAntiAiVideoFilter(), "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", posted]);
        }
        brollFiles.push(posted);
      }

      // 2) сборка: видео = лицо[0..cut] + b-roll'ы + (опц.) хвост лица; аудио = ПОЛНЫЙ голос хука
      const voiceDur = probeDuration(ffbin, reel.voice_src);
      const cut = Math.min(reel.face_cut_s || 3.5, voiceDur - 1);
      const tail = reel.tail_face_s || 0;
      const midBudget = Math.max(0.8, voiceDur - cut - tail);
      const per = midBudget / brollFiles.length;

      const inputs = ["-i", reel.voice_src];
      for (const f of brollFiles) inputs.push("-i", f);
      const norm = "setsar=1,settb=AVTB,format=yuv420p";
      const parts = [`[0:v]trim=0:${cut.toFixed(2)},setpts=PTS-STARTPTS,scale=1080:1920,fps=30,${norm}[v0]`];
      const labels = ["[v0]"];
      brollFiles.forEach((_, i) => {
        parts.push(`[${i + 1}:v]trim=0:${per.toFixed(2)},setpts=PTS-STARTPTS,scale=1080:1920,fps=30,${norm}[v${i + 1}]`);
        labels.push(`[v${i + 1}]`);
      });
      if (tail > 0) {
        parts.push(`[0:v]trim=${(voiceDur - tail).toFixed(2)}:${voiceDur.toFixed(2)},setpts=PTS-STARTPTS,scale=1080:1920,fps=30,${norm}[vt]`);
        labels.push("[vt]");
      }
      parts.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[v]`);
      const outFile = `${OUT}/${reel.id}.mp4`;
      ffmpeg(ffbin, [
        "-y", ...inputs,
        "-filter_complex", parts.join(";"),
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "3800k", "-maxrate", "4400k", "-bufsize", "7600k",
        "-c:a", "aac", "-b:a", "96k", "-shortest", outFile,
      ]);
      // полоса всего рилса для ревью
      const dur = probeDuration(ffbin, outFile);
      ffmpeg(ffbin, ["-y", "-i", outFile, "-vf", `fps=1/${(dur / 6.05).toFixed(3)},scale=340:-1,tile=6x1`, "-frames:v", "1", `${OUT}/${reel.id}-strip.jpg`]);
      state.reels[reel.id] = { out: outFile, duration: dur, broll: brollFiles.length, date: new Date().toISOString().slice(0, 10) };
      saveState(state);
      console.log(`REEL DONE ${reel.id} (${dur.toFixed(1)}s)`);
    } catch (e) {
      console.log(`REEL FAIL ${reel.id}: ${String(e?.message || e).slice(0, 250)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
