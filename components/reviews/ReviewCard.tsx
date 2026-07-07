"use client";

import { useState } from "react";
import { Star, Video } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatTime } from "@/lib/analytics/format";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import type { ReviewRow } from "@/app/api/reviews/route";

function Thumb({ nmId }: { nmId: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div className="h-11 w-11 shrink-0 rounded bg-slate-100" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={wbCardImageUrl(nmId)} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded border border-slate-200 object-cover" onError={() => setBroken(true)} />;
}

// glyph — звёзды сами по себе несут сигнал не только цветом (дальтоники/ч-б экраны)
function ratingTone(r: number): string {
  if (r >= 4) return "text-emerald-600";
  if (r === 3) return "text-amber-500";
  return "text-red-600";
}

export function ReviewCard({ r }: { r: ReviewRow }) {
  const [photo, setPhoto] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Thumb nmId={r.nmId} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{r.article || r.nmId}</span>
            {r.brandName && <span className="text-xs text-slate-400">{r.brandName}</span>}
          </div>
          {r.productName && <p className="truncate text-xs text-slate-400">{r.productName}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`flex items-center gap-0.5 text-sm font-semibold ${ratingTone(r.rating)}`}>
            {r.rating}<Star className="h-3.5 w-3.5 fill-current" />
          </span>
          <span className="text-[11px] text-slate-400">{formatTime(r.createdAt)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        {r.isAnswered ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Отвечено</span>
        ) : (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.rating <= 2 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>Без ответа</span>
        )}
        {r.hasVideo && <span className="flex items-center gap-1 text-[11px] text-slate-400"><Video className="h-3.5 w-3.5" /> видео</span>}
      </div>

      {r.text && <p className="mt-2 text-sm text-slate-700">{r.text}</p>}
      {r.pros && <p className="mt-1 text-sm text-emerald-700">+ {r.pros}</p>}
      {r.cons && <p className="mt-1 text-sm text-red-700">− {r.cons}</p>}
      {r.isAnswered && r.answerText && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">
          <span className="font-medium text-slate-500">Ответ продавца: </span>{r.answerText}
        </div>
      )}

      {r.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.photos.map((p, i) => p.mini && (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p.mini} alt="" loading="lazy" onClick={() => setPhoto(p.full || p.mini || null)}
              className="h-14 w-14 cursor-pointer rounded border border-slate-200 object-cover hover:opacity-80" />
          ))}
        </div>
      )}

      <Modal open={!!photo} onClose={() => setPhoto(null)} title="Фото отзыва">
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="max-h-[70vh] w-full rounded-lg object-contain" />
        )}
      </Modal>
    </div>
  );
}
