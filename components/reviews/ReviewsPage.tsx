"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Star } from "lucide-react";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { CategoryFilter, categoriesOnScreen, filterByCategory } from "@/components/ui/CategoryFilter";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { LoadingBanner, SkeletonCards, SkeletonKpiRow, useElapsedSeconds } from "@/components/ui/LoadingState";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import type { ReviewRow } from "@/app/api/reviews/route";

interface Kpi { avgRating30d: number | null; count30d: number; unansweredTotal: number; critical7d: number }
type Answered = "" | "answered" | "unanswered";

function ratingTone(r: number | null): string {
  if (r == null) return "text-gray-400";
  if (r >= 4.5) return "text-emerald-600";
  if (r >= 3.5) return "text-amber-500";
  return "text-red-600";
}

export function ReviewsPage() {
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const [days, setDays] = useState(30);
  const [rating, setRating] = useState<number | null>(null);
  const [answered, setAnswered] = useState<Answered>("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const LIMIT = 30;

  const fetchPage = useCallback(async (nextOffset: number) => {
    const params = new URLSearchParams({ days: String(days), limit: String(LIMIT), offset: String(nextOffset) });
    if (cabId) params.set("cabinet", cabId);
    if (rating) params.set("rating", String(rating));
    if (answered) params.set("answered", answered);
    const res = await fetch(`/api/reviews?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [cabId, days, rating, answered]);

  useEffect(() => {
    if (!cabReady) return;
    let ignore = false;
    setLoading(true); setError(null); setOffset(0);
    fetchPage(0)
      .then((json) => {
        if (ignore) return;
        if (!json.ok) { setError(json.error || "Ошибка загрузки"); return; }
        setRows(json.rows ?? []);
        setKpi(json.kpi ?? null);
        setHasMore(!!json.hasMore);
        setSyncError(json.lastSyncError ?? null);
      })
      .catch((e) => { if (!ignore) setError(String(e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [cabReady, fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = offset + LIMIT;
      const json = await fetchPage(next);
      if (json.ok) {
        setRows((r) => [...r, ...(json.rows ?? [])]);
        setOffset(next);
        setHasMore(!!json.hasMore);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const filtered = filterByCategory(rows, (r) => r.article, byArticle, category);
  const catOptions = categoriesOnScreen(rows, (r) => r.article, byArticle, categories);

  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><MessageSquare className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Отзывы</h1>
            <p className="text-xs text-gray-500">покупательские отзывы WB</p>
          </div>
          <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
            <CategoryFilter categories={catOptions.categories} hasUncategorized={catOptions.hasUncategorized} value={category} onChange={setCategory} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="отзывы WB" />
            <SkeletonKpiRow count={4} />
            <SkeletonCards count={4} />
          </>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : (
          <>
            {syncError && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{syncError}</div>
            )}

            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-medium text-gray-500">Средний рейтинг (30д)</div>
                <div className={`mt-0.5 flex items-center gap-1 text-xl font-bold tabular-nums ${ratingTone(kpi?.avgRating30d ?? null)}`}>
                  {kpi?.avgRating30d ?? "—"}<Star className="h-4 w-4 fill-current" />
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-medium text-gray-500">Без ответа</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-amber-600">{kpi?.unansweredTotal ?? 0}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-medium text-gray-500">Критично: 1-2★ без ответа (7д)</div>
                <div className={`mt-0.5 text-xl font-bold tabular-nums ${(kpi?.critical7d ?? 0) > 0 ? "text-red-600" : "text-gray-900"}`}>{kpi?.critical7d ?? 0}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-[11px] font-medium text-gray-500">Отзывов за 30 дней</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums">{kpi?.count30d ?? 0}</div>
              </div>
            </div>

            {/* Пилюли фильтров были около 26px в высоту и стояли впритык:
                «4★» и «3★» в паре пикселей друг от друга, а это основной способ
                добраться до критичных отзывов. Ниже lg цель — 44px. */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
                {([null, 5, 4, 3, 2, 1] as const).map((v) => (
                  <button key={v ?? "all"} onClick={() => setRating(v)}
                    className={`tap-row inline-flex items-center rounded px-3 py-1 text-xs font-semibold sm:px-2.5 ${rating === v ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>
                    {v == null ? "Все" : `${v}★`}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
                {([["", "Все"], ["unanswered", "Без ответа"], ["answered", "Отвечено"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setAnswered(v)}
                    className={`tap-row inline-flex items-center rounded px-3 py-1 text-xs font-semibold sm:px-2.5 ${answered === v ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
                {([7, 30, 90] as const).map((d) => (
                  <button key={d} onClick={() => setDays(d)}
                    className={`tap-row inline-flex items-center rounded px-3 py-1 text-xs font-semibold sm:px-2.5 ${days === d ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>
                    {d}д
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
                Нет отзывов за выбранный период/фильтр.
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((r) => <ReviewCard key={r.id} r={r} />)}
              </div>
            )}

            {hasMore && (
              <button onClick={loadMore} disabled={loadingMore}
                className="mt-4 w-full rounded-lg border border-gray-200 bg-white py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {loadingMore ? "Загружаем…" : "Показать ещё"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
