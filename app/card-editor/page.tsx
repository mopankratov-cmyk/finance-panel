"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Type, Download, ImagePlus, Trash2 } from "lucide-react";
import { downloadBlob } from "@/lib/analytics/format";

interface Layer {
  id: number; text: string; x: number; y: number; // x,y относительные 0..1 (центр текста)
  size: number; color: string; weight: number; pill: boolean; pillColor: string;
}

const PRESETS: { label: string; mk: () => Omit<Layer, "id" | "x" | "y"> }[] = [
  { label: "Заголовок", mk: () => ({ text: "ЗАГОЛОВОК", size: 0.075, color: "#ffffff", weight: 800, pill: true, pillColor: "rgba(17,24,39,.78)" }) },
  { label: "Выгода", mk: () => ({ text: "−50% сегодня", size: 0.05, color: "#ffffff", weight: 700, pill: true, pillColor: "#2563eb" }) },
  { label: "Цена", mk: () => ({ text: "1 990 ₽", size: 0.09, color: "#ffffff", weight: 800, pill: true, pillColor: "#dc2626" }) },
  { label: "Простой текст", mk: () => ({ text: "текст", size: 0.05, color: "#111827", weight: 600, pill: false, pillColor: "#000" }) },
];

function Editor() {
  const sp = useSearchParams();
  const initial = sp.get("img");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const seq = useRef(1);

  const proxied = (u: string) => (u.startsWith("/") ? u : `/api/lab/img-proxy?url=${encodeURIComponent(u)}`);

  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.onerror = () => setReady(false);
    img.src = src;
  }, []);

  useEffect(() => { if (initial) loadImage(proxied(initial)); }, [initial, loadImage]);

  const draw = useCallback(() => {
    const cv = canvasRef.current, img = imgRef.current;
    if (!cv || !img) return;
    const W = Math.min(img.naturalWidth, 1200); const scale = W / img.naturalWidth; const H = img.naturalHeight * scale;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    for (const l of layers) {
      const fs = l.size * W;
      ctx.font = `${l.weight} ${fs}px Arial, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tw = ctx.measureText(l.text).width;
      const px = l.x * W, py = l.y * H;
      if (l.pill) {
        const padX = fs * 0.5, padY = fs * 0.32, r = fs * 0.4;
        const bx = px - tw / 2 - padX, by = py - fs / 2 - padY, bw = tw + padX * 2, bh = fs + padY * 2;
        ctx.fillStyle = l.pillColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, r); else ctx.rect(bx, by, bw, bh);
        ctx.fill();
      } else {
        ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = fs * 0.15; ctx.shadowOffsetY = 2;
      }
      ctx.fillStyle = l.color; ctx.shadowColor = l.pill ? "transparent" : "rgba(0,0,0,.5)";
      ctx.fillText(l.text, px, py);
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (l.id === sel) {
        ctx.strokeStyle = "#7c3aed"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(px - tw / 2 - 6, py - fs / 2 - 6, tw + 12, fs + 12); ctx.setLineDash([]);
      }
    }
  }, [layers, sel]);

  useEffect(() => { draw(); }, [draw, ready]);

  const addLayer = (mk: () => Omit<Layer, "id" | "x" | "y">) => {
    const id = seq.current++;
    setLayers((p) => [...p, { id, x: 0.5, y: 0.85, ...mk() }]); setSel(id);
  };
  const upd = (id: number, patch: Partial<Layer>) => setLayers((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const del = (id: number) => { setLayers((p) => p.filter((l) => l.id !== id)); if (sel === id) setSel(null); };

  // Указательные события вместо мышиных: на касании iOS присылает по тапу
  // синтетические mousedown/mouseup, но mousemove при протяжке пальцем — нет,
  // поэтому слой выбирался и дальше не двигался ни на телефоне, ни на iPad.
  const evtRel = (e: React.PointerEvent) => {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = evtRel(e);
    // выбрать ближайший слой по близости центра; пальцем целятся грубее мыши
    let best: Layer | null = null, bd = e.pointerType === "mouse" ? 0.08 : 0.12;
    for (const l of layers) { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } }
    if (best) {
      setSel(best.id);
      drag.current = { id: best.id, dx: best.x - x, dy: best.y - y };
      // Захват указателя: палец легко уходит за край холста, а без захвата
      // перетаскивание там обрывается.
      e.currentTarget.setPointerCapture(e.pointerId);
    } else setSel(null);
  };
  const onMove = (e: React.PointerEvent) => { if (!drag.current) return; const { x, y } = evtRel(e); upd(drag.current.id, { x: Math.max(0, Math.min(1, x + drag.current.dx)), y: Math.max(0, Math.min(1, y + drag.current.dy)) }); };
  const onUp = () => { drag.current = null; };

  const download = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    // Через blob и общий загрузчик: якорь с data-URL, не вставленный в
    // документ, в Safari на iOS не скачивает ничего и молча.
    cv.toBlob((blob) => { if (blob) downloadBlob(blob, "card.png"); }, "image/png");
  };
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) loadImage(URL.createObjectURL(f)); };

  const cur = layers.find((l) => l.id === sel) || null;

  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-100 text-pink-700"><Type className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-extrabold tracking-tight">Текст на карточку</h1><p className="text-xs text-gray-500">Наложение заголовков, выгод и цены · экспорт PNG</p></div>
          <div className="ml-auto flex w-full gap-2 sm:w-auto">
            <label className="tap-row flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 sm:flex-none"><ImagePlus className="h-4 w-4" />Своё фото<input type="file" accept="image/*" className="hidden" onChange={onUpload} /></label>
            <button onClick={download} disabled={!ready} className="tap-row flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300 sm:flex-none"><Download className="h-4 w-4" />Скачать PNG</button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_320px]">
        <div className="flex items-start justify-center rounded-xl border border-gray-200 bg-white p-4">
          {ready ? (
            <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="max-h-[75dvh] w-auto cursor-move touch-none rounded shadow" style={{ maxWidth: "100%" }} />
          ) : (
            <div className="py-24 text-center text-sm text-gray-400">{initial ? "Загружаю изображение…" : "Загрузи фото или открой из лаборатории (?img=…)"}</div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Добавить</div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => <button key={p.label} onClick={() => addLayer(p.mk)} disabled={!ready} className="rounded-lg border border-gray-200 px-2 py-2 text-sm hover:border-violet-300 hover:bg-violet-50 disabled:opacity-40">{p.label}</button>)}
            </div>
          </div>

          {cur && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-gray-400">Слой</span><button onClick={() => del(cur.id)} aria-label="Удалить слой" className="tap-hit -m-1 p-1 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>
              <input value={cur.text} onChange={(e) => upd(cur.id, { text: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <label className="block text-xs text-gray-500">Размер<input type="range" min={0.02} max={0.16} step={0.005} value={cur.size} onChange={(e) => upd(cur.id, { size: Number(e.target.value) })} className="w-full" /></label>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <label className="flex items-center gap-1.5">Текст<input type="color" value={cur.color} onChange={(e) => upd(cur.id, { color: e.target.value })} /></label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={cur.pill} onChange={(e) => upd(cur.id, { pill: e.target.checked })} />Плашка</label>
                {cur.pill && <label className="flex items-center gap-1.5">Цвет<input type="color" value={cur.pillColor.startsWith("#") ? cur.pillColor : "#111827"} onChange={(e) => upd(cur.id, { pillColor: e.target.value })} /></label>}
              </div>
              <div className="flex gap-1">
                {[600, 700, 800].map((w) => <button key={w} onClick={() => upd(cur.id, { weight: w })} className={`tap-row flex-1 rounded px-2 py-1 text-xs ${cur.weight === w ? "bg-violet-600 text-white" : "bg-gray-100"}`}>{w === 600 ? "обычный" : w === 700 ? "жирный" : "чёрный"}</button>)}
              </div>
              <p className="text-xs text-gray-400">Перетаскивай текст прямо на холсте — мышью или пальцем.</p>
            </div>
          )}
          {!cur && ready && <p className="px-1 text-xs text-gray-400">Добавь текст пресетом и кликни по нему на холсте, чтобы редактировать.</p>}
        </aside>
      </main>
    </div>
  );
}

export default function CardEditorPage() {
  return <Suspense fallback={<div className="p-10 text-center text-gray-400">Загрузка…</div>}><Editor /></Suspense>;
}
