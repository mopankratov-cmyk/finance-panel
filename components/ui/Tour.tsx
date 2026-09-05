"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { useIsPhone } from "@/hooks/useMediaQuery";

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
  // Размер подсказки нужен, чтобы посадить её в экран целиком. Раньше под неё
  // резервировали константу 180px, а реальная высота на узком экране доходит до
  // 230px — ряд «Назад / Далее / Готово» уезжал за нижнюю кромку, оверлей не
  // прокручивался, и пройти тур было нечем.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [card, setCard] = useState({ width: 320, height: 200 });
  const isPhone = useIsPhone();

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

  // Замеряем подсказку после каждой смены шага: от её высоты зависит, влезает
  // ли она под подсвеченным элементом или должна встать над ним.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    setCard((prev) => (prev.width === el.offsetWidth && prev.height === el.offsetHeight ? prev : { width: el.offsetWidth, height: el.offsetHeight }));
  }, [active, idx, isPhone]);

  // Тур — полноэкранное наложение, и до этого выйти из него можно было только
  // тапом по фону: Escape не слушался вовсе.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setActive(false);
      try { localStorage.setItem(seenKey(tourId), "1"); } catch { /* ignore */ }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, tourId]);

  if (!active || !steps.length) return null;
  const step = steps[idx];

  const close = () => {
    setActive(false);
    try { localStorage.setItem(seenKey(tourId), "1"); } catch { /* ignore */ }
  };
  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : close());
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  // На телефоне подсказка садится листом у края экрана — с той стороны, где
  // нет подсвеченного элемента, чтобы не закрыть то, о чём рассказывает.
  const nearBottom = !!rect && rect.top > window.innerHeight / 2;
  const gap = 12;
  const fit = (value: number, size: number, limit: number) => Math.max(gap, Math.min(value, limit - size - gap));
  // Под подсказкой места может не хватить — тогда ставим её НАД элементом.
  const below = rect ? rect.bottom + gap : 0;
  const above = rect ? rect.top - gap - card.height : 0;
  const tooltipTop = rect
    ? fit(below + card.height + gap > window.innerHeight && above > gap ? above : below, card.height, window.innerHeight)
    : Math.max(gap, window.innerHeight / 2 - card.height / 2);
  const tooltipLeft = rect
    ? fit(rect.left, card.width, window.innerWidth)
    : Math.max(gap, window.innerWidth / 2 - card.width / 2);

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-4 ring-violet-400 transition-all"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-label={step.title}
        className={`absolute max-h-[80dvh] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl ${
          isPhone
            ? `inset-x-3 ${nearBottom ? "top-[calc(0.75rem+var(--safe-t))]" : "bottom-[calc(0.75rem+var(--safe-b))]"}`
            : "w-[min(20rem,calc(100vw-2rem))]"
        }`}
        style={isPhone ? undefined : { top: tooltipTop, left: tooltipLeft }}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">{step.title}</p>
          <button type="button" aria-label="Закрыть подсказку" onClick={close} className="tap-hit -m-1 shrink-0 p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-sm text-slate-600">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{idx + 1}/{steps.length}</span>
          <div className="flex gap-2">
            {idx > 0 && <button onClick={prev} className="tap-row rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">Назад</button>}
            <button onClick={next} className="tap-row rounded-lg bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700">
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
    <button onClick={replay} title="Показать подсказки по странице" aria-label="Показать подсказки по странице" className="inline-flex items-center justify-center rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-violet-600 max-lg:h-11 max-lg:w-11">
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
