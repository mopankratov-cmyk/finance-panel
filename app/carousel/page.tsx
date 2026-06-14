"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Images, Download, ImagePlus } from "lucide-react";

interface ProductOpt { article: string; name: string; img?: string }

function CarouselBuilder() {
  const sp = useSearchParams();
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [article, setArticle] = useState("");
  const [imgUrl, setImgUrl] = useState<string>("");
  const [texts, setTexts] = useState<string>(sp.get("texts") ? decodeURIComponent(sp.get("texts")!).split("\n").join("\n") : "Хук в первый слайд\nВыгода 1\nВыгода 2\n−50% сегодня\nИщи на WB по артикулу");
  const [accent, setAccent] = useState("#e11d48");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);

  const proxied = (u: string) => (u.startsWith("/") ? u : `/api/lab/img-proxy?url=${encodeURIComponent(u)}`);

  useEffect(() => { fetch("/api/lab/sku-list").then((r) => r.json()).then((d) => setProducts((d.items || []).map((i: { art: string; name: string; img_url?: string }) => ({ article: i.art, name: i.name, img: i.img_url })))).catch(() => {}); }, []);

  const loadImage = useCallback((src: string) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.onerror = () => setReady(false);
    img.src = src;
  }, []);

  // фон по выбранному артикулу: фото карточки WB (через прокси)
  useEffect(() => {
    const initImg = sp.get("img");
    if (initImg) { setImgUrl(initImg); loadImage(proxied(initImg)); }
  }, [sp, loadImage]);

  const pickProduct = (art: string) => {
    setArticle(art);
    const p = products.find((x) => x.article === art);
    if (p?.img) { setImgUrl(p.img); loadImage(proxied(p.img)); }
  };

  const slides = texts.split("\n").map((t) => t.trim()).filter(Boolean);

  const drawSlide = useCallback((cv: HTMLCanvasElement | null, text: string, idx: number) => {
    const img = imgRef.current; if (!cv || !img) return;
    const W = 1080, H = 1350; cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    const ir = img.naturalWidth / img.naturalHeight, cr = W / H;
    let dw = W, dh = H, dx = 0, dy = 0;
    if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; } else { dw = W; dh = W / ir; dy = (H - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(0, 0, W, H);
    const top = idx === 0;
    const fs = top ? 86 : 64;
    ctx.font = `800 ${fs}px Arial, sans-serif`; ctx.textAlign = "center";
    const words = text.split(" "); const lines: string[] = []; let line = "";
    for (const w of words) { const t2 = line ? line + " " + w : w; if (ctx.measureText(t2).width > W * 0.82 && line) { lines.push(line); line = w; } else line = t2; }
    if (line) lines.push(line);
    const lh = fs * 1.18; const blockH = lines.length * lh;
    const cy = top ? H * 0.18 : H * 0.5 - blockH / 2;
    lines.forEach((ln, i) => {
      const y = cy + i * lh; const tw = ctx.measureText(ln).width;
      ctx.fillStyle = accent; const padX = fs * 0.45, padY = fs * 0.22;
      const bx = W / 2 - tw / 2 - padX, by = y - fs * 0.8, bw = tw + padX * 2, bh = fs + padY * 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 16); ctx.fill(); } else ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "#fff"; ctx.fillText(ln, W / 2, y + fs * 0.1);
    });
  }, [accent]);

  useEffect(() => { if (ready) slides.forEach((t, i) => drawSlide(refs.current[i], t, i)); }, [ready, slides, drawSlide]);

  const downloadAll = () => { slides.forEach((_, i) => { const cv = refs.current[i]; if (!cv) return; const a = document.createElement("a"); a.download = `slide-${i + 1}.png`; a.href = cv.toDataURL("image/png"); a.click(); }); };
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { setImgUrl(URL.createObjectURL(f)); loadImage(URL.createObjectURL(f)); } };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><Images className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-extrabold tracking-tight">Сборщик карусели</h1><p className="text-xs text-gray-500">слайды из фото товара + тексты сценария · экспорт PNG (1080×1350)</p></div>
          <button onClick={downloadAll} disabled={!ready} className="ml-auto flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300"><Download className="h-4 w-4" />Скачать все</button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Фон</div>
            <select value={article} onChange={(e) => pickProduct(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">— фото товара из списка —</option>
              {products.map((p) => <option key={p.article} value={p.article}>{(p.article + " · " + (p.name || "")).slice(0, 50)}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"><ImagePlus className="h-4 w-4" />Своё фото<input type="file" accept="image/*" className="hidden" onChange={onUpload} /></label>
            <label className="flex items-center gap-2 text-xs text-gray-500">Акцент<input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Тексты слайдов (по строке)</div>
            <textarea value={texts} onChange={(e) => setTexts(e.target.value)} rows={8} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <p className="mt-1 text-[11px] text-gray-400">Первая строка = крупный хук (вверху). Остальные — по центру.</p>
          </div>
        </aside>
        <div>
          {ready ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {slides.map((t, i) => (
                <div key={i} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <canvas ref={(el) => { refs.current[i] = el; }} className="w-full" style={{ aspectRatio: "1080/1350" }} />
                  <div className="truncate px-2 py-1 text-[11px] text-gray-500">{i + 1}. {t}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white py-24 text-center text-sm text-gray-400">{imgUrl ? "Загружаю фон…" : "Выбери товар или загрузи фото"}</div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function CarouselPage() {
  return <Suspense fallback={<div className="p-10 text-center text-gray-400">Загрузка…</div>}><CarouselBuilder /></Suspense>;
}
