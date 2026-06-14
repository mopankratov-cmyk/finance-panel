"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Download, Play, Square } from "lucide-react";

function OverlayEditor() {
  const sp = useSearchParams();
  const [src, setSrc] = useState("");
  const [hook, setHook] = useState(sp.get("hook") ? decodeURIComponent(sp.get("hook")!) : "");
  const [cta, setCta] = useState("Ищи на WB по артикулу");
  const [subs, setSubs] = useState("");
  const [accent, setAccent] = useState("#e11d48");
  const [recording, setRecording] = useState(false);
  const [outUrl, setOutUrl] = useState("");
  const [msg, setMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number>(0);

  const proxied = (u: string) => (u.startsWith("/") ? u : `/api/lab/media-proxy?url=${encodeURIComponent(u)}`);

  useEffect(() => {
    const s = sp.get("src");
    if (s) setSrc(s);
  }, [sp]);

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
    const words = text.split(" "); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  };

  const drawPillText = useCallback((ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, fs: number, W: number, color: string) => {
    ctx.font = `800 ${fs}px Arial, sans-serif`; ctx.textAlign = "center";
    const lines = wrapText(ctx, text, W * 0.82);
    const lh = fs * 1.2;
    lines.forEach((ln, i) => {
      const y = cy + i * lh; const tw = ctx.measureText(ln).width;
      const padX = fs * 0.4, padY = fs * 0.2;
      ctx.fillStyle = color;
      const bx = cx - tw / 2 - padX, by = y - fs * 0.85, bw = tw + padX * 2, bh = fs + padY * 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 14); ctx.fill(); } else ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "#fff"; ctx.fillText(ln, cx, y);
    });
    return lines.length * lh;
  }, []);

  const renderFrame = useCallback(() => {
    const v = videoRef.current, cv = canvasRef.current;
    if (!v || !cv) return;
    const W = cv.width, H = cv.height;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(v, 0, 0, W, H);
    const t = v.currentTime, dur = v.duration || 1;
    const subLines = subs.split("\n").map((x) => x.trim()).filter(Boolean);

    // Хук — первые 3 сек, сверху
    if (hook && t < 3) {
      ctx.save(); ctx.globalAlpha = t > 2.5 ? Math.max(0, (3 - t) / 0.5) : 1;
      drawPillText(ctx, hook, W / 2, H * 0.16, Math.round(W * 0.075), W, accent);
      ctx.restore();
    }

    // Субтитры — равномерно по таймлайну (между 1с и последними 2.5с), снизу
    if (subLines.length) {
      const start = 1, end = Math.max(start + 1, dur - 2.5);
      const seg = (end - start) / subLines.length;
      const idx = Math.floor((t - start) / seg);
      if (idx >= 0 && idx < subLines.length && t >= start && t < end) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.font = `700 ${Math.round(W * 0.05)}px Arial, sans-serif`; ctx.textAlign = "center";
        const fs = Math.round(W * 0.05);
        const lines = wrapText(ctx, subLines[idx], W * 0.86);
        const lh = fs * 1.25; const blockH = lines.length * lh;
        const baseY = H * 0.82;
        ctx.fillRect(0, baseY - fs, W, blockH + fs * 0.6);
        ctx.fillStyle = "#fff";
        lines.forEach((ln, i) => ctx.fillText(ln, W / 2, baseY + i * lh));
        ctx.restore();
      }
    }

    // CTA — последние 2.5 сек, плашка по центру низа
    if (cta && t > dur - 2.5) {
      ctx.save(); ctx.globalAlpha = Math.min(1, (t - (dur - 2.5)) / 0.4);
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, H);
      drawPillText(ctx, cta, W / 2, H * 0.5, Math.round(W * 0.07), W, accent);
      ctx.restore();
    }
  }, [hook, cta, subs, accent, drawPillText]);

  const loop = useCallback(() => {
    renderFrame();
    rafRef.current = requestAnimationFrame(loop);
  }, [renderFrame]);

  const onLoaded = () => {
    const v = videoRef.current, cv = canvasRef.current;
    if (!v || !cv) return;
    cv.width = v.videoWidth || 720; cv.height = v.videoHeight || 1280;
    renderFrame();
  };

  const startRecord = async () => {
    const v = videoRef.current, cv = canvasRef.current;
    if (!v || !cv) return;
    setOutUrl(""); setMsg("запись…");
    try {
      const out = cv.captureStream(30);
      // звук исходного видео
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vstream = (v as any).captureStream ? (v as any).captureStream() : null;
      if (vstream) vstream.getAudioTracks().forEach((tr: MediaStreamTrack) => out.addTrack(tr));
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      recRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => { const blob = new Blob(chunks, { type: "video/webm" }); setOutUrl(URL.createObjectURL(blob)); setMsg("✓ готово — скачай webm"); setRecording(false); };
      v.currentTime = 0; await v.play();
      rec.start();
      setRecording(true);
      cancelAnimationFrame(rafRef.current); loop();
      v.onended = () => { rec.stop(); cancelAnimationFrame(rafRef.current); };
    } catch (e) { setMsg("ошибка записи: " + String(e).slice(0, 80)); setRecording(false); }
  };

  const stopRecord = () => { recRef.current?.stop(); cancelAnimationFrame(rafRef.current); videoRef.current?.pause(); };

  useEffect(() => { loop(); return () => cancelAnimationFrame(rafRef.current); }, [loop]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><Clapperboard className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-extrabold tracking-tight">Монтаж-оверлей</h1><p className="text-xs text-gray-500">хук-текст + субтитры + CTA поверх готового видео · запись webm со звуком</p></div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Источник</div>
            <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="URL видео (из банка завода)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button onClick={() => { if (src) { setSrc(src); const v = videoRef.current; if (v) { v.src = proxied(src); v.load(); } } }} className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200">Загрузить</button>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Оверлеи</div>
            <label className="block text-xs text-gray-500">Хук (первые 3с, сверху)
              <input value={hook} onChange={(e) => setHook(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-gray-500">Субтитры (по строке, равномерно)
              <textarea value={subs} onChange={(e) => setSubs(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-gray-500">CTA (последние 2.5с)
              <input value={cta} onChange={(e) => setCta(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="flex items-center gap-2 text-xs text-gray-500">Акцент<input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
          </div>
          <div className="flex gap-2">
            {!recording ? (
              <button onClick={startRecord} disabled={!src} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300"><Play className="h-4 w-4" />Записать с оверлеями</button>
            ) : (
              <button onClick={stopRecord} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"><Square className="h-4 w-4" />Стоп</button>
            )}
            {outUrl && <a href={outUrl} download="overlay.webm" className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white"><Download className="h-4 w-4" />webm</a>}
          </div>
          <div className="text-[11px] text-gray-400" >{msg}</div>
        </aside>
        <div className="space-y-3">
          <canvas ref={canvasRef} className="mx-auto rounded-xl border border-gray-200 bg-black" style={{ maxHeight: "70vh", aspectRatio: "9/16" }} />
          <video ref={videoRef} crossOrigin="anonymous" playsInline muted={false} onLoadedMetadata={onLoaded} className="hidden" />
          {outUrl && <video src={outUrl} controls className="mx-auto rounded-xl border border-gray-200" style={{ maxHeight: "40vh" }} />}
        </div>
      </main>
    </div>
  );
}

export default function VideoOverlayPage() {
  return <Suspense fallback={<div className="p-10 text-center text-gray-400">Загрузка…</div>}><OverlayEditor /></Suspense>;
}
