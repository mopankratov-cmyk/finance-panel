"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Shuffle, Download, Play, Square } from "lucide-react";

interface Variant { idx: number; url: string; recipe: string; }

function Uniquizer() {
  const sp = useSearchParams();
  const [src, setSrc] = useState("");
  const [count, setCount] = useState(5);
  const [strength, setStrength] = useState(6); // % jitter
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Variant[]>([]);
  const [msg, setMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const abortRef = useRef(false);

  const proxied = (u: string) => (u.startsWith("/") ? u : `/api/lab/media-proxy?url=${encodeURIComponent(u)}`);

  useEffect(() => { const s = sp.get("src"); if (s) setSrc(s); }, [sp]);

  // детерминированный псевдослучай по seed, чтобы рецепт был воспроизводим
  const rng = (seed: number) => { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

  const makeRecipe = (seed: number) => {
    const r = rng(seed * 7919 + 13);
    const k = strength / 100;
    return {
      mirror: r() > 0.5,
      zoom: 1 + r() * 0.09,
      dx: (r() - 0.5) * 0.05,
      dy: (r() - 0.5) * 0.05,
      bright: 1 + (r() - 0.5) * 2 * k,
      contrast: 1 + (r() - 0.5) * 2 * k,
      sat: 1 + (r() - 0.5) * 2 * k,
      hue: Math.round((r() - 0.5) * 12),
      speed: 1 + (r() - 0.5) * 0.1,
      trim: r() * 0.4,
      vignette: 0.1 + r() * 0.18,
    };
  };

  const recipeStr = (rc: ReturnType<typeof makeRecipe>) =>
    `${rc.mirror ? "↔ " : ""}zoom ${rc.zoom.toFixed(2)} · ${rc.speed.toFixed(2)}x · hue ${rc.hue}° · trim ${rc.trim.toFixed(2)}s`;

  const drawVariant = useCallback((rc: ReturnType<typeof makeRecipe>) => {
    const v = videoRef.current, cv = canvasRef.current; if (!v || !cv) return;
    const W = cv.width, H = cv.height; const ctx = cv.getContext("2d")!;
    ctx.save();
    ctx.filter = `brightness(${rc.bright}) contrast(${rc.contrast}) saturate(${rc.sat}) hue-rotate(${rc.hue}deg)`;
    if (rc.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    const zw = W * rc.zoom, zh = H * rc.zoom;
    ctx.drawImage(v, (W - zw) / 2 + rc.dx * W, (H - zh) / 2 + rc.dy * H, zw, zh);
    ctx.restore();
    // виньетка
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${rc.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }, []);

  const recordOne = (rc: ReturnType<typeof makeRecipe>): Promise<string> => new Promise((resolve, reject) => {
    const v = videoRef.current, cv = canvasRef.current; if (!v || !cv) return reject("no video");
    const out = cv.captureStream(30);

    const vstream = (v as any).captureStream ? (v as any).captureStream() : null;
    if (vstream) vstream.getAudioTracks().forEach((tr: MediaStreamTrack) => out.addTrack(tr));
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: "video/webm" })));
    v.playbackRate = rc.speed;
    v.currentTime = rc.trim;
    const loop = () => { drawVariant(rc); rafRef.current = requestAnimationFrame(loop); };
    v.onended = () => { rec.stop(); cancelAnimationFrame(rafRef.current); };
    v.play().then(() => { rec.start(); loop(); }).catch(reject);
  });

  const load = () => { const v = videoRef.current; if (v && src) { v.src = proxied(src); v.load(); setDone([]); setMsg(""); } };

  const onLoaded = () => {
    const v = videoRef.current, cv = canvasRef.current; if (!v || !cv) return;
    cv.width = v.videoWidth || 720; cv.height = v.videoHeight || 1280;
  };

  const run = async () => {
    if (busy || !src) return;
    setBusy(true); setDone([]); abortRef.current = false;
    const results: Variant[] = [];
    for (let i = 0; i < count; i++) {
      if (abortRef.current) break;
      setMsg(`вариант ${i + 1}/${count}…`);
      const rc = makeRecipe(i + 1);
      try { const url = await recordOne(rc); results.push({ idx: i + 1, url, recipe: recipeStr(rc) }); setDone([...results]); }
      catch (e) { setMsg("ошибка: " + String(e).slice(0, 80)); break; }
    }
    setMsg(`✓ готово: ${results.length} вариантов`); setBusy(false);
  };

  const stop = () => { abortRef.current = true; videoRef.current?.pause(); cancelAnimationFrame(rafRef.current); setBusy(false); };
  const dlAll = () => done.forEach((d) => { const a = document.createElement("a"); a.href = d.url; a.download = `unique-${d.idx}.webm`; a.click(); });

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><Shuffle className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-extrabold tracking-tight">Уникализатор</h1><p className="text-xs text-gray-500">один ролик → N почти-неотличимых копий под разные аккаунты (антибан) · webm со звуком</p></div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Источник</div>
            <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="URL видео (из банка завода)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button onClick={load} className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200">Загрузить</button>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Параметры</div>
            <label className="block text-xs text-gray-500">Сколько копий: <b>{count}</b>
              <input type="range" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1 w-full" /></label>
            <label className="block text-xs text-gray-500">Сила изменений: <b>{strength}%</b>
              <input type="range" min={2} max={14} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="mt-1 w-full" /></label>
            <p className="text-[11px] text-gray-400">Каждая копия: зеркало, кроп-зум, сдвиг цвета/яркости/оттенка, скорость ±5%, обрезка старта, виньетка. Рецепт детерминирован по номеру.</p>
          </div>
          <div className="flex gap-2">
            {!busy ? (
              <button onClick={run} disabled={!src} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300"><Play className="h-4 w-4" />Сделать {count} копий</button>
            ) : (
              <button onClick={stop} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"><Square className="h-4 w-4" />Стоп</button>
            )}
            {done.length > 0 && <button onClick={dlAll} className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white"><Download className="h-4 w-4" />Все</button>}
          </div>
          <div className="text-[11px] text-gray-400">{msg}</div>
        </aside>
        <div className="space-y-3">
          <canvas ref={canvasRef} className="mx-auto rounded-xl border border-gray-200 bg-black" style={{ maxHeight: "45vh", aspectRatio: "9/16" }} />
          <video ref={videoRef} crossOrigin="anonymous" playsInline onLoadedMetadata={onLoaded} className="hidden" />
          {done.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {done.map((d) => (
                <div key={d.idx} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <video src={d.url} controls className="w-full" style={{ aspectRatio: "9/16" }} />
                  <div className="px-2 py-1">
                    <div className="text-[11px] font-medium">Копия {d.idx}</div>
                    <div className="text-[10px] text-gray-400 truncate">{d.recipe}</div>
                    <a href={d.url} download={`unique-${d.idx}.webm`} className="text-[10px] text-rose-600">скачать</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function UniquizerPage() {
  return <Suspense fallback={<div className="p-10 text-center text-gray-400">Загрузка…</div>}><Uniquizer /></Suspense>;
}
