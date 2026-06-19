import sharp from "sharp";

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

// Кадры (first/middle/last) из видео через fal extract-frame → JPEG base64 (как ждёт video-critic).
export async function extractFrames(videoUrl: string): Promise<string[]> {
  const k = process.env.FAL_KEY;
  if (!k || !videoUrl) return [];
  const out: string[] = [];
  for (const frame_type of ["first", "middle", "last"]) {
    try {
      const r = await fetch("https://fal.run/fal-ai/ffmpeg-api/extract-frame", {
        method: "POST", headers: { Authorization: `Key ${k}`, "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ video_url: videoUrl, frame_type }), signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { images?: { url?: string }[] };
      const u = j.images?.[0]?.url;
      if (!u) continue;
      const img = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (!img.ok) continue;
      const jpeg = await sharp(Buffer.from(await img.arrayBuffer())).resize(512, null, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      out.push(jpeg.toString("base64"));
    } catch { /* пропускаем кадр */ }
  }
  return out;
}
