"use client";

import Link from "next/link";
import { Check, ExternalLink, EyeOff, ImageOff, RotateCcw } from "lucide-react";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "@/lib/assortment/constants";
import { availableActions, isReferenceStatus } from "@/lib/assortment/decisions";
import type { FeedCard } from "@/lib/assortment/feed";
import type { SignalTone } from "@/lib/assortment/signals";

const TONE: Record<SignalTone, string> = {
  retail: "bg-amber-100 text-amber-900",
  novelty: "bg-violet-100 text-violet-800",
  single: "bg-slate-200 text-slate-700",
  manual: "bg-sky-100 text-sky-900",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });

export function FeedGrid({
  cards,
  direction,
  selected,
  selectionFull,
  busyId,
  onToggle,
  onQuickAction,
}: {
  cards: FeedCard[];
  direction: AssortmentDirection;
  selected: Set<string>;
  selectionFull: boolean;
  busyId: string | null;
  onToggle: (id: string) => void;
  onQuickAction: (card: FeedCard, action: "archived" | "restore") => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => {
        const href = `${ASSORTMENT_BASE_PATH}/${direction}/${card.id}`;
        const actions = isReferenceStatus(card.status) ? availableActions(card.status) : [];
        const quick = actions.includes("archived") ? "archived" : actions.includes("restore") ? "restore" : null;
        const isSelected = selected.has(card.id);
        return (
          <li key={card.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-white ${isSelected ? "border-violet-500 ring-2 ring-violet-200" : "border-slate-200"}`}>
            <div className="relative">
              <Link href={href} className="block aspect-[4/5] bg-[#ece9e3]">
                {card.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.coverUrl} alt={card.title} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                    <ImageOff className="h-8 w-8" />
                    <span className="text-xs">фото нет</span>
                  </div>
                )}
              </Link>
              <span className={`pointer-events-none absolute left-3 top-3 max-w-[70%] truncate rounded-full px-2.5 py-1 text-xs font-medium ${TONE[card.signal.tone]}`}>
                {card.signal.label}
              </span>
              {(isSelected || !selectionFull) && (
                <button
                  type="button"
                  onClick={() => onToggle(card.id)}
                  aria-pressed={isSelected}
                  aria-label={isSelected ? "Убрать из сравнения" : "Добавить к сравнению"}
                  className={`absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full ${isSelected ? "bg-violet-700 text-white" : "bg-white/90 text-slate-600 hover:bg-white"}`}
                >
                  <Check className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3">
              <div>
                <Link href={href} className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 hover:text-violet-800">{card.title}</Link>
                <div className="text-xs text-slate-500">{[card.brand, card.region].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                <span>Впервые у нас {day(card.firstSeenAt)}</span>
                {card.status !== "new" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{card.statusLabel}</span>}
              </div>
              <p className="text-xs leading-5 text-slate-700"><span className="text-slate-500">Почему показали: </span>{card.signal.why}</p>
              {card.lesson && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-900">{card.lesson}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                {card.url && (
                  <a href={card.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50">
                    <ExternalLink className="h-3.5 w-3.5" /> Источник
                  </a>
                )}
                {quick && (
                  <button
                    type="button"
                    disabled={busyId === card.id}
                    onClick={() => onQuickAction(card, quick)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {quick === "archived" ? <><EyeOff className="h-3.5 w-3.5" /> Скрыть</> : <><RotateCcw className="h-3.5 w-3.5" /> Вернуть в ленту</>}
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
