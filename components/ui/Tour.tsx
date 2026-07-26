"use client";

import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";

export interface TourStep {
  /** CSS-селектор подсвечиваемого элемента, напр. data-tour="attention" */
  selector: string;
  title: string;
  text: string;
}

const seenKey = (tourId: string) => `fp_tour_seen_${tourId}`;
const replayEvent = (tourId: string) => `fp-tour-replay:${tourId}`;

// Показывает тур один раз (localStorage), повторно — через TourReplayButton того же tourId.
export function Tour({ tourId, steps }: { tourId: string; steps: TourStep[] }) {
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem(seenKey(tourId)) === "1"; } catch { /* ignore */ }
    if (!seen) { setActive(true); setIdx(0); }
    const onReplay = () => { setActive(true); setIdx(0); };
    window.addEventListener(replayEvent(tourId), onReplay);
    return () => window.removeEventListener(replayEvent(tourId), onReplay);
  }, [tourId]);

  useEffect(() => {
    if (!active) return;
    const step = steps[idx];
    const el = step ? document.querySelector(step.selector) : null;
    if (!el) { setRect(null); return; }

    // rect — координаты вьюпорта, а плавающий скролл (наш scrollIntoView ИЛИ ручной
    // скролл пользователя) их меняет непрерывно, пока не осядет — без слушателя
    // scroll/resize подсветка и тултип "отклеиваются" от реального элемента.
    const update = () => setRect(el.getBoundingClientRect());
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, idx, steps]);

  if (!active || !steps.length) return null;
  const step = steps[idx];

  const close = () => {
    setActive(false);
    try { localStorage.setItem(seenKey(tourId), "1"); } catch { /* ignore */ }
  };
  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : close());
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  const tooltipTop = rect ? Math.min(rect.bottom + 12, window.innerHeight - 180) : window.innerHeight / 2 - 60;
  const tooltipLeft = rect ? Math.min(Math.max(rect.left, 16), window.innerWidth - 320) : window.innerWidth / 2 - 150;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-4 ring-violet-400 transition-all"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="absolute w-80 rounded-xl bg-white p-4 shadow-2xl" style={{ top: tooltipTop, left: tooltipLeft }}>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">{step.title}</p>
          <button type="button" aria-label="Закрыть подсказку" onClick={close} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-sm text-slate-600">{step.text}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">{idx + 1}/{steps.length}</span>
          <div className="flex gap-2">
            {idx > 0 && <button onClick={prev} className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">Назад</button>}
            <button onClick={next} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700">
              {idx < steps.length - 1 ? "Далее" : "Готово"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Кнопка "?" — сбрасывает localStorage и триггерит повторный показ тура той же страницы.
export function TourReplayButton({ tourId }: { tourId: string }) {
  const replay = () => {
    try { localStorage.removeItem(seenKey(tourId)); } catch { /* ignore */ }
    window.dispatchEvent(new Event(replayEvent(tourId)));
  };
  return (
    <button onClick={replay} title="Показать подсказки по странице" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-violet-600">
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
