"use client";

import Link from "next/link";
import { ImageOff } from "lucide-react";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "@/lib/assortment/constants";
import type { SimilarResult } from "@/lib/assortment/similarStore";

/** Похожие модели раздела по фото: подсказка «посмотрите рядом», не «та же модель». */
export function SimilarModels({ direction, similar }: { direction: AssortmentDirection; similar: SimilarResult }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Похожие модели</h2>
        <span className="text-xs text-slate-500">По фото. Похожие ≠ одна и та же модель: проверьте глазами.</span>
      </div>
      {similar.state === "not_ready" && <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">{similar.reason}</p>}
      {similar.state === "ready" && similar.items.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Похожих по фото среди моделей раздела пока нет.</p>
      )}
      {similar.state === "ready" && similar.items.length > 0 && (
        <ul className="chip-row flex gap-3">
          {similar.items.map((item) => (
            <li key={item.id} className="w-36 shrink-0">
              <Link href={`${ASSORTMENT_BASE_PATH}/${direction}/${item.id}`} className="flex flex-col gap-1.5">
                <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-[#ece9e3]">
                  {item.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.coverUrl} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400"><ImageOff className="h-6 w-6" /></div>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-800">{item.similarity}%</span>
                </div>
                <span className="line-clamp-2 text-xs font-medium text-slate-900">{item.title}</span>
                <span className="text-xs text-slate-500">{item.brand}{item.sameBrand && " · тот же бренд"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
