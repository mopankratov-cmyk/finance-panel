"use client";

import { ExternalLink, ImageOff } from "lucide-react";
import type { FeedCard } from "@/lib/assortment/feed";
import type { SignalTone } from "@/lib/assortment/signals";

const TONE: Record<SignalTone, string> = {
  retail: "bg-amber-100 text-amber-900",
  novelty: "bg-violet-100 text-violet-800",
  single: "bg-slate-200 text-slate-700",
  manual: "bg-sky-100 text-sky-900",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });

export function FeedGrid({ cards }: { cards: FeedCard[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <li key={card.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="relative aspect-[4/5] bg-[#ece9e3]">
            {card.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.coverUrl} alt={card.title} loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                <ImageOff className="h-8 w-8" />
                <span className="text-xs">фото нет</span>
              </div>
            )}
            <span className={`absolute left-3 top-3 max-w-[85%] truncate rounded-full px-2.5 py-1 text-xs font-medium ${TONE[card.signal.tone]}`}>
              {card.signal.label}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3">
            <div>
              <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{card.title}</h3>
              <div className="text-xs text-slate-500">{[card.brand, card.region].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="text-xs text-slate-600">Впервые у нас {day(card.firstSeenAt)}</div>
            <p className="text-xs leading-5 text-slate-700"><span className="text-slate-500">Почему показали: </span>{card.signal.why}</p>
            {card.url && (
              <a href={card.url} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex h-10 items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50">
                <ExternalLink className="h-3.5 w-3.5" /> Источник
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
