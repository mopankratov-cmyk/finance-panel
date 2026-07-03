// Раннер Drill Loop: исполняет батч плана bloggerDrillLoop с пер-клип resume.
// Леджер в РЕПО: docs/factory-blogger-drill-ledger.json (урок «/tmp — кладбище»).
// npx tsx lib/factory/bloggerDrillRunner.mjs --batch 1 --axis light_scene \
//   --ffmpeg <path> --confirm-paid true [--only clip_id] [--dry-run]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDrillBatch, drillDeglossPrompt } from "./bloggerDrillLoop.ts";

const MANYA_GROUP = "fc29c149d7994673b254dd121c1dc516";
const NASTYA = "YjESejviApN7SHrbfnA2";
const LEDGER = "docs/factory-blogger-drill-ledger.json";
const OUT = "/tmp/ugc-factory-drill";

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
async function hg(path, init = {}) {
  const res = await fetchR(`https://api.heygen.com${path}`, {
    ...init,
    headers: { "x-api-key": ENV.HEYGEN_API_KEY, "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  return data;
}
async function tgHostAudio(buf) {
  const form = new FormData();
  form.append("chat_id", ENV.FACTORY_TG_CHAT_ID);
  form.append("audio", new Blob([buf], { type: "audio/mpeg" }), "v.mp3");
  form.append("disable_notification", "true");
  const sent = await (await fetchR(`https://api.telegram.org/bot${ENV.FACTORY_TG_BOT_TOKEN}/sendAudio`, { method: "POST", body: form })).json();
  if (!sent.ok) throw new Error("tg host failed");
  const info = await (await fetchR(`https://api.telegram.org/bot${ENV.FACTORY_TG_BOT_TOKEN}/getFile?file_id=${sent.result.audio.file_id}`)).json();
  await fetchR(`https://api.telegram.org/bot${ENV.FACTORY_TG_BOT_TOKEN}/deleteMessage?chat_id=${ENV.FACTORY_TG_CHAT_ID}&message_id=${sent.result.message_id}`);
  return `https://api.telegram.org/file/bot${ENV.FACTORY_TG_BOT_TOKEN}/${info.result.file_path}`;
}
function ffmpeg(bin, args) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(-200)}`);
}
function loadLedger() {
  return existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { clips: {}, degloss_cache: {}, look_cache: {}, promotions: [] };
}
// Гейт против рамки-мокапа телефона в деглянц-стиллах (b9: текстовый запрет в промпте
// НЕ спасает — Seedream запекает бейзел). Калибровка на стиллах b1-b9: у чёрного бейзела
// ≥3 края с YAVG<38 (b08_06: 32/28/36/85, b09_02: 27/22/24/47); легитимные тёмные сцены
// не опускаются ниже 43 (hallway_dusk: 60/65/49/43). Светлые/врезанные рамки (b09_04)
// люмой не ловятся — их добирает vision-критик по полосе.
async function hasBezel(ffbin, imageUrl) {
  const tmp = `${OUT}/bezel-check-${Date.now()}.png`;
  writeFileSync(tmp, Buffer.from(await (await fetchR(imageUrl)).arrayBuffer()));
  const crops = [
    "crop=iw*0.035:ih:0:0",
    "crop=iw*0.035:ih:iw-iw*0.035:0",
    "crop=iw:ih*0.035:0:0",
    "crop=iw:ih*0.035:0:ih-ih*0.035",
  ];
  const lumas = crops.map((c) => {
    const r = spawnSync(ffbin, ["-i", tmp, "-vf", `${c},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
    const m = (r.stderr || "").match(/YAVG=([\d.]+)/);
    return m ? Number(m[1]) : 255;
  });
  try { spawnSync("rm", [tmp]); } catch {}
  return lumas.filter((y) => y < 38).length >= 3;
}
function saveLedger(l) {
  writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

async function main() {
  const batch = Number(argValue("--batch", "1"));
  const axis = argValue("--axis", "light_scene");
  const ffbin = argValue("--ffmpeg");
  const plan = buildDrillBatch(batch, axis);
  if (!plan.ok) throw new Error(plan.warnings.join("; "));
  mkdirSync(`${OUT}/b${batch}`, { recursive: true });
  const only = argValue("--only");

  if (!boolArg("--confirm-paid")) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", batch, clips: plan.clips.map((c) => c.clip_id) }, null, 2));
    return;
  }
  const ledger = loadLedger();

  // 1) TTS с кэшем по скрипту+параметрам (одинаковые скрипты батча делят один войсовер)
  const { createHash } = await import("node:crypto");
  ledger.tts_cache = ledger.tts_cache || {};
  async function ttsFor(clip) {
    const key = createHash("sha1").update(`${clip.script}::${clip.voice_emotion_speed.style}::${clip.voice_emotion_speed.speed}`).digest("hex").slice(0, 12);
    if (!ledger.tts_cache[key]) {
      const tts = await falQueue("fal-ai/elevenlabs/tts/eleven-v3", {
        text: clip.script, voice: NASTYA,
        stability: 0.4, similarity_boost: 0.8,
        style: clip.voice_emotion_speed.style, speed: clip.voice_emotion_speed.speed,
        language_code: "ru",
      });
      const buf = Buffer.from(await (await fetchR(tts.audio.url)).arrayBuffer());
      ledger.tts_cache[key] = await tgHostAudio(buf);
      saveLedger(ledger);
    }
    return ledger.tts_cache[key];
  }
  console.log("TTS-PER-CLIP READY");

  const avatars = (await hg(`/v2/avatar_group/${MANYA_GROUP}/avatars`))?.data?.avatar_list || [];

  for (const clip of plan.clips) {
    if (only && clip.clip_id !== only) continue;
    const rec = ledger.clips[clip.clip_id] || { plan: clip };
    ledger.clips[clip.clip_id] = rec;
    try {
      // 2) деглянц с кэшем по look+hint
      const dgKey = `${clip.look_name}::${clip.degloss_hint}::${clip.pose_hint || ""}`;
      if (!ledger.degloss_cache[dgKey]) {
        const look = avatars.find((a) => a.name === clip.look_name);
        if (!look?.image_url) throw new Error(`look ${clip.look_name} not found`);
        const dg = await falQueue("fal-ai/bytedance/seedream/v4.5/edit", {
          prompt: drillDeglossPrompt(clip.degloss_hint, clip.pose_hint),
          image_urls: [look.image_url], num_images: 1,
          image_size: { width: 1152, height: 2048 },
        });
        const url = dg.images?.[0]?.url;
        if (!url) throw new Error("degloss 0 images");
        // анти-бейзел гейт: до 2 перегенераций с ужесточённым промптом
        let cleanUrl = url;
        if (ffbin) {
          cleanUrl = null;
          let candidate = url;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (!(await hasBezel(ffbin, candidate))) { cleanUrl = candidate; break; }
            if (attempt === 2) break;
            console.log(`DEGLOSS BEZEL ${clip.clip_id} attempt ${attempt + 1} — regenerating`);
            const rg = await falQueue("fal-ai/bytedance/seedream/v4.5/edit", {
              prompt: drillDeglossPrompt(clip.degloss_hint, clip.pose_hint) + " The photograph fills the entire canvas edge to edge: no black bars, no device bezel or notch, no rounded screen corners, no phone mockup frame.",
              image_urls: [look.image_url], num_images: 1,
              image_size: { width: 1152, height: 2048 },
            });
            candidate = rg.images?.[0]?.url;
            if (!candidate) throw new Error("degloss regen 0 images");
          }
          if (!cleanUrl) throw new Error("degloss bezel persists after 2 retries");
        }
        ledger.degloss_cache[dgKey] = cleanUrl;
        saveLedger(ledger);
      }
      // 3) деглянц-лук в группу с кэшем
      const lookCacheKey = `drill::${dgKey}`;
      if (!ledger.look_cache[lookCacheKey]) {
        const imgBuf = Buffer.from(await (await fetchR(ledger.degloss_cache[dgKey])).arrayBuffer());
        const up = await fetchR("https://upload.heygen.com/v1/asset", {
          method: "POST", headers: { "x-api-key": ENV.HEYGEN_API_KEY, "Content-Type": "image/png" }, body: imgBuf,
        });
        const imageKey = (await up.json())?.data?.image_key;
        const lookName = `drill_${clip.clip_id}`;
        await hg("/v2/photo_avatar/avatar_group/add", {
          method: "POST",
          body: JSON.stringify({ group_id: MANYA_GROUP, image_keys: [imageKey], name: lookName }),
        });
        await sleep(20000);
        const av2 = (await hg(`/v2/avatar_group/${MANYA_GROUP}/avatars`))?.data?.avatar_list || [];
        const added = av2.find((a) => a.name === lookName);
        if (!added) throw new Error("look not registered");
        ledger.look_cache[lookCacheKey] = added.id;
        saveLedger(ledger);
      }
      // 4) Avatar IV 1080p
      if (!rec.video_done) {
        const audioUrl = await ttsFor(clip);
        const create = await hg("/v3/videos", {
          method: "POST",
          body: JSON.stringify({
            type: "avatar", avatar_id: ledger.look_cache[lookCacheKey], title: clip.clip_id,
            aspect_ratio: "9:16", resolution: "1080p", output_format: "mp4",
            audio_url: audioUrl, engine: { type: "avatar_iv" },
            motion_prompt: clip.motion_prompt, expressiveness: clip.expressiveness,
          }),
        });
        const videoId = create?.data?.video_id;
        rec.heygen_video_id = videoId;
        saveLedger(ledger);
        let videoUrl = "";
        for (let i = 0; i < 110; i++) {
          await sleep(i < 5 ? 5000 : 8000);
          const st = await hg(`/v3/videos/${encodeURIComponent(videoId)}`);
          const d = st?.data || st;
          if (d?.video_url) { videoUrl = d.video_url; break; }
          const state = d?.status || d?.state;
          if (state === "failed" || state === "error") throw new Error("render failed");
        }
        if (!videoUrl) throw new Error("render timeout");
        // скачивание видео долгим таймаутом (45с fetchR рвал загрузку — b12_04)
        {
          let vbuf, lastErr;
          for (let t = 1; t <= 3 && !vbuf; t++) {
            try {
              const vres = await rawFetch(videoUrl, { signal: AbortSignal.timeout(240_000) });
              if (!vres.ok) throw new Error(`video download ${vres.status}`);
              vbuf = Buffer.from(await vres.arrayBuffer());
            } catch (e) { lastErr = e; await sleep(3000 * t); }
          }
          if (!vbuf) throw lastErr;
          writeFileSync(`${OUT}/b${batch}/${clip.clip_id}-raw.mp4`, vbuf);
        }
        rec.video_done = true;
        saveLedger(ledger);
      }
      // 5) пост + полоса (если дан ffmpeg)
      if (ffbin && !rec.post_done) {
        const raw = `${OUT}/b${batch}/${clip.clip_id}-raw.mp4`;
        const final = `${OUT}/b${batch}/${clip.clip_id}.mp4`;
        const graded = `${OUT}/b${batch}/${clip.clip_id}-graded.mp4`;
        const probe = spawnSync(ffbin, ["-i", raw, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-frames:v", "30", "-f", "null", "-"], { encoding: "utf8" });
        const lumas = [...(probe.stderr || "").matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
        const yavg = lumas.length ? lumas.reduce((a, b) => a + b, 0) / lumas.length : 120;
        const eq = yavg < 105 ? "eq=contrast=1.05:saturation=1.06:gamma=1.06:brightness=0.04" : "eq=contrast=1.06:saturation=1.05:gamma=1.0:brightness=0.01";
        const curves = yavg < 105 ? "curves=all='0/0.01 0.5/0.53 1/0.99'" : "curves=all='0/0.02 0.5/0.52 1/0.98'";
        ffmpeg(ffbin, ["-y", "-i", raw, "-f", "lavfi", "-i", "anoisesrc=colour=brown:amplitude=0.0035:r=44100",
          "-filter_complex",
          `[0:v]fps=30,scale=iw*1.04:ih*1.04:flags=lanczos,crop=iw/1.04:ih/1.04:x='(in_w-out_w)/2+4*sin(t*1.3)+1.5*sin(t*7.9)':y='(in_h-out_h)/2+2*sin(t*1.7)+1*sin(t*9.3)',${eq},colortemperature=temperature=6400,${curves},cas=0.55,rgbashift=rh=-1:bh=1,noise=alls=8:allf=t+u,vignette=PI/8[v];[0:a]highpass=f=120,lowpass=f=9000,acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2,aecho=0.8:0.88:30|45:0.18|0.12[voice];[voice][1:a]amix=inputs=2:duration=first:normalize=0[a]`,
          "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "17", "-tune", "grain", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", graded]);
        ffmpeg(ffbin, ["-y", "-i", graded, "-vf", "noise=alls=5:allf=t+u", "-c:v", "libx264", "-profile:v", "main", "-b:v", "3800k", "-maxrate", "4400k", "-bufsize", "7600k", "-c:a", "aac", "-b:a", "96k", final]);
        // полоса: шаг семплирования от ДЛИТЕЛЬНОСТИ клипа (фикс. 1/1.2 на коротких клипах
        // давал <5 кадров и tile добивал слоты чёрным — критик читал это как битый рендер)
        const durM = (probe.stderr || "").match(/Duration: (\d+):(\d+):([\d.]+)/);
        const durS = durM ? Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3]) : 6;
        ffmpeg(ffbin, ["-y", "-i", final, "-vf", `fps=1/${(durS / 5.05).toFixed(3)},scale=400:-1,tile=5x1`, "-frames:v", "1", `${OUT}/b${batch}/${clip.clip_id}-strip.jpg`]);
        rec.post_done = true;
        rec.yavg = Math.round(yavg);
        saveLedger(ledger);
        try { spawnSync("rm", [graded]); } catch {}
      }
      console.log(`CLIP DONE ${clip.clip_id}`);
    } catch (e) {
      rec.error = String(e?.message || e).slice(0, 250);
      saveLedger(ledger);
      console.log(`CLIP FAIL ${clip.clip_id}: ${rec.error.slice(0, 120)}`);
    }
  }
  const done = Object.values(ledger.clips).filter((c) => c.post_done).length;
  console.log(JSON.stringify({ ok: true, batch, clips_post_done: done, out: `${OUT}/b${batch}` }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(String(e?.stack || e)); process.exit(1); });
}
