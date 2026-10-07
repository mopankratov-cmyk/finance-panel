"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { nicheLinks, nichesFor } from "@/lib/assortment/chinaLinks";
import { DIRECTION_LABEL, type AssortmentDirection } from "@/lib/assortment/constants";

type Filter = "all" | AssortmentDirection;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "jackets", label: DIRECTION_LABEL.jackets },
  { value: "bags", label: DIRECTION_LABEL.bags },
];

const linkButton = "inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 hover:bg-slate-50";

/**
 * «Китайские площадки — ссылки»: ниши «Китай (1688)» с китайскими ключами — поиск 1688 по продажам, поиск Taobao и AlphaShop, чтобы
 * посмотреть нишу руками. Без сбора и без ключа 1688: страница доступна всегда, панель ничего не скачивает и не хранит. Только женское.
 */
export function ChinaLinksPage({ initialFilter = "all" }: { initialFilter?: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const niches = nichesFor(filter === "all" ? null : filter);
  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900">Китайские площадки — ссылки</h1>
          <p className="text-sm leading-6 text-slate-600">
            Ниши курток и сумок (только женское) с китайскими ключами — чтобы посмотреть выдачу руками. Ссылки открывают площадку у вас в
            браузере; панель ничего не собирает. Цены на площадках есть — в панель мы их не переносим. Оптовые продажи в Китае — не спрос WB.
          </p>
        </header>

        <div role="radiogroup" aria-label="Раздел" className="flex gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`h-11 rounded-full px-4 text-sm ${filter === item.value ? "bg-slate-900 font-medium text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {niches.map((niche) => (
            <li key={niche.key} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-slate-900">{niche.ru}</span>
                <span className="text-xs text-slate-500">{DIRECTION_LABEL[niche.direction]}</span>
              </div>
              <div className="text-sm text-slate-600">
                Ключ: <span lang="zh" className="select-all font-medium text-slate-900">{niche.zh[0]}</span>
                {niche.zh.length > 1 && <span lang="zh" className="text-slate-500"> · ещё: {niche.zh.slice(1).join(", ")}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {nicheLinks(niche).map((l) => (
                  <a key={l.platform} href={l.url} target="_blank" rel="noopener noreferrer" title={l.note} className={linkButton}>
                    <ExternalLink className="h-4 w-4" /> {l.label}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-5 text-slate-500">
          <li>1688 — оптовая выдача, отсортированная по продажам за 30 дней; число продаж там — счётчик площадки «корзиной», период не указан.</li>
          <li>Taobao — розница Китая; площадка просит вход в аккаунт.</li>
          <li>AlphaShop (遨虾) — ИИ-агент 1688 для закупщиков: поиска по адресу нет, вставьте ключ ниши; нужна регистрация.</li>
        </ul>
      </div>
    </div>
  );
}
