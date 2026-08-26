"use client";

import { useEffect, useMemo, useState } from "react";
import { wbCardImageUrlsForDisplay } from "@/lib/wb/cardImage";

interface WbProductImageProps {
  nm?: number | null;
  src?: string | null;
  alt?: string;
  className: string;
  loading?: "eager" | "lazy";
  size?: string;
  /**
   * Артикул для заглушки. Когда фото у WB нет вовсе (архивная карточка или
   * снятое изображение), серый прямоугольник читается как поломка панели.
   * Подпись с артикулом честнее: строка опознаётся, и видно, что это не сбой.
   */
  label?: string | null;
}

/** Спокойные пары «фон/текст». Цвет закреплён за товаром, а не случайный. */
const PLACEHOLDER_TONES = [
  "bg-slate-100 text-slate-500",
  "bg-violet-100 text-violet-600",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-600",
];

/**
 * Короткая подпись: первый кусок артикула до разделителя.
 * «101/86(матовая)/голубая» → «101», «673/бежевая» → «673».
 */
function shortLabel(label: string | null | undefined, nm: number | null | undefined): string {
  const source = String(label ?? "").trim();
  const head = source.split(/[\/\s·—-]/).filter(Boolean)[0];
  if (head) return head.slice(0, 6);
  const digits = String(nm ?? "");
  return digits ? digits.slice(-4) : "—";
}

export function WbProductImage({ nm, src, alt = "", className, loading = "lazy", size = "c246x328", label }: WbProductImageProps) {
  const urls = useMemo(() => wbCardImageUrlsForDisplay({ nmId: nm, src, size }), [nm, size, src]);
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [src, nm, size]);

  if (!urls[index]) {
    // Кандидаты кончились: фото у WB нет. Рисуем подпись, а не пустоту.
    const tone = PLACEHOLDER_TONES[Math.abs(Number(nm ?? 0)) % PLACEHOLDER_TONES.length];
    return (
      <span
        className={`${className} grid place-items-center ${tone} text-[9px] font-bold uppercase leading-none tracking-tight`}
        title={label ? `Фото нет у WB · ${label}` : "Фото нет у WB"}
      >
        <span className="px-0.5 text-center">{shortLabel(label, nm)}</span>
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={urls[index]} alt={alt} loading={loading} className={className} onError={() => setIndex((current) => current + 1)} />;
}
