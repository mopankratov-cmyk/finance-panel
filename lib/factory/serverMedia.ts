import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

// Серверные аналоги браузерных canvas-кусков завода — чтобы фоновые джобы давали полное качество без вкладки.
// (1) overlayPngBase64 — прозрачный PNG-оверлей (хук+субтитры) через sharp (SVG→PNG), как _renderOverlayPng.
// (2) extractFrames — кадры из готового видео через fal ffmpeg extract-frame, как _extractFrames, для ОТК.

function esc(s: string): string {
  return String(s || "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
// Простой перенос по словам (на сервере нет measureText — оцениваем по символам).
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (t.length > maxChars && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 2): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok || i === attempts - 1) return r;
    } catch {
      if (i === attempts - 1) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
  }
  return null;
}

function falMediaKey(): string {
  return process.env.FAL_KEY || process.env.FAL_BILLING_KEY || "";
}

// 720×1280 прозрачный PNG: хук-плашка сверху, субтитры снизу (центр чист — товар виден).
export async function overlayPngBase64(hook: string, subs: string[]): Promise<string | null> {
  try {
    const W = 720, H = 1280;
    const band = (lines: string[], y0: number, fs: number, lh: number): string => {
      if (!lines.length) return "";
      const bg = `<rect x="0" y="${Math.round(y0 - lh * 0.7)}" width="${W}" height="${Math.round(lines.length * lh + lh * 0.4)}" fill="rgba(0,0,0,0.42)"/>`;
      const txt = lines.map((ln, i) =>
        `<text x="${W / 2}" y="${Math.round(y0 + i * lh)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${fs}" fill="#ffffff" stroke="rgba(0,0,0,0.85)" stroke-width="6" paint-order="stroke">${esc(ln)}</text>`).join("");
      return bg + txt;
    };
    const hookBand = band(wrap(hook, 18, 3), H * 0.17, 56, 66);
    const subLines = (subs || []).filter(Boolean).slice(0, 4).flatMap((s) => wrap(s, 26, 2)).slice(0, 6);
    const subBand = band(subLines, H * 0.74, 40, 50);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${hookBand}${subBand}</svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return png.toString("base64");
  } catch { return null; }
}

// Server-side карусель: аналог браузерного _renderCarousel (Canvas → sharp+SVG).
// Блюр+затемнение фон, товар contain по центру, хук-текст сверху/субтитры снизу.
// Возвращает base64-JPEG строки (формат совместим с gen-save slides[]).
export async function buildCarouselSlides(imageUrl: string, texts: string[]): Promise<string[]> {
  try {
    const r = await fetch(imageUrl, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) return [];
    const imgBuf = Buffer.from(await r.arrayBuffer());
    const W = 1080, H = 1350;
    const slides: string[] = [];
    for (const [idx, rawText] of texts.filter(Boolean).slice(0, 5).entries()) {
      const text = String(rawText);
      // блюр+затемнение как фон
      const bgBuf = await sharp(imgBuf)
        .resize(W, H, { fit: "cover" }).blur(22).jpeg({ quality: 80 }).toBuffer();
      // полупрозрачный тёмный оверлей (35%)
      const darkenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="rgba(0,0,0,0.38)"/></svg>`;
      // товар: contain по центру (прозрачный фон → PNG)
      const productBuf = await sharp(imgBuf)
        .resize(W, H, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      // текстовый SVG: хук сверху (idx=0), остальное снизу
      const isHook = idx === 0;
      const fs = isHook ? 80 : 58;
      const lines = wrap(text, Math.floor(W * 0.84 / (fs * 0.58)), 4);
      const lh = fs * 1.16;
      const blockH = lines.length * lh;
      const cy = isHook ? H * 0.14 : H - H * 0.13 - blockH + lh;
      const bandH = blockH + fs * 0.6;
      const textEls = lines.map((ln, i) => {
        const y = Math.round(cy + i * lh + fs * 0.1);
        return [
          `<rect x="${Math.round(W * 0.08)}" y="${Math.round(cy + i * lh - fs * 0.78)}" width="${Math.round(W * 0.84)}" height="${Math.round(fs + fs * 0.36)}" rx="14" fill="#e11d48"/>`,
          `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${fs}" fill="#ffffff">${esc(ln)}</text>`,
        ].join("");
      }).join("");
      const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="${Math.round(cy - fs)}" width="${W}" height="${Math.round(bandH)}" fill="rgba(0,0,0,0.45)"/>${textEls}</svg>`;
      const slide = await sharp(bgBuf)
        .composite([
          { input: Buffer.from(darkenSvg), blend: "over" },
          { input: productBuf, blend: "over" },
          { input: Buffer.from(svgText), blend: "over" },
        ])
        .jpeg({ quality: 86 }).toBuffer();
      slides.push(slide.toString("base64"));
    }
    return slides;
  } catch { return []; }
}

// Кадры (first/middle/last) из видео через fal extract-frame → JPEG base64 (как ждёт video-critic).
// ПАРАЛЛЕЛЬНО: раньше серийно 3 кадра × до 50с = до 150с → шаг otk не влезал ни в лиз (90с), ни в
// maxDuration (60с) → Vercel убивал хендлер до savePlan (ОТК/output_url терялись) ИЛИ лиз протухал в
// середине шага → крон захватывал тот же рецепт и гонял otk повторно (повторный платный video-critic).
// Promise.all сохраняет порядок [first, middle, last], который ждёт video-critic.
export async function extractFrames(videoUrl: string): Promise<string[]> {
  const k = falMediaKey();
  if (!k || !videoUrl) return [];
  const results = await Promise.all((["first", "middle", "last"] as const).map(async (frame_type) => {
    try {
      const r = await fetchWithRetry("https://fal.run/fal-ai/ffmpeg-api/extract-frame", {
        method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ video_url: videoUrl, frame_type }), signal: AbortSignal.timeout(30000),
      });
      if (!r?.ok) return null;
      const j = (await r.json().catch(() => ({}))) as { images?: { url?: string }[] };
      const u = j.images?.[0]?.url;
      if (!u) return null;
      const img = await fetchWithRetry(u, { signal: AbortSignal.timeout(20000) });
      if (!img?.ok) return null;
      const jpeg = await sharp(Buffer.from(await img.arrayBuffer())).resize(512, null, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      return jpeg.toString("base64");
    } catch { return null; /* пропускаем кадр */ }
  }));
  return results.filter((x): x is string => !!x);
}

// Постер-кадр (первый) для галереи «База видосов»: fal extract-frame → sharp JPG → Storage → публичный URL.
// Чинит «пустые тёмные квадраты» — <video preload=metadata #t=0.1> не рендерит первый кадр на supabase
// (range-requests). Один fal-вызов (дешевле extractFrames с 3). Best-effort: любой сбой → null (галерея
// откатывается на попытку кадра из <video>, как раньше).
export async function extractPosterUrl(db: SupabaseClient, videoUrl: string, bucket: string, pathBase: string): Promise<string | null> {
  const k = falMediaKey();
  if (!k || !videoUrl) return null;
  try {
    const r = await fetchWithRetry("https://fal.run/fal-ai/ffmpeg-api/extract-frame", {
      method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ video_url: videoUrl, frame_type: "first" }), signal: AbortSignal.timeout(25000),
    });
    if (!r?.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { images?: { url?: string }[] };
    const u = j.images?.[0]?.url;
    if (!u) return null;
    const img = await fetchWithRetry(u, { signal: AbortSignal.timeout(15000) });
    if (!img?.ok) return null;
    const jpeg = await sharp(Buffer.from(await img.arrayBuffer())).resize(420, null, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    const path = `${pathBase}.jpg`;
    const { error } = await db.storage.from(bucket).upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
    if (error) return null;
    return db.storage.from(bucket).getPublicUrl(path).data?.publicUrl || null;
  } catch { return null; }
}
