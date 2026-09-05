"use client";

import { useState } from "react";

import { WbEmptyState } from "@/components/wb/WbModuleHeader";
import { adGet, adPost, type AdCluster } from "./adControlApi";
import type { ConfirmRequest } from "./ConfirmAction";
import type { CampaignRow } from "./campaignRow";

interface ClusterResponse {
  active: AdCluster[];
  excluded: AdCluster[];
  archived: AdCluster[];
  bidsError: string | null;
  note: string;
}

/**
 * Кластеры и минус-фразы — самый тонкий рычаг WB и самый опасный.
 *
 * Опасный из-за того, как устроен метод минус-фраз: WB заменяет весь набор
 * присланным, слова «добавить» у него нет. Поэтому интерфейс не даёт
 * редактировать список текстом целиком — только «добавить эти» и «убрать эти»,
 * а слияние делает сервер, прочитав текущий набор. Поле со всеми фразами
 * выглядело бы удобнее ровно до первого раза, когда кто-то стёр в нём лишнее и
 * сохранил.
 */
export function AdClustersTab({
  cabinetId,
  rows,
  currency,
  onAsk,
}: {
  cabinetId: string;
  rows: CampaignRow[];
  currency: string;
  onAsk: (request: ConfirmRequest) => void;
}) {
  const manual = rows.filter((row) => row.campaign.bid_type !== "unified" && row.campaign.status !== 7);
  const [selected, setSelected] = useState<CampaignRow | null>(null);
  const [data, setData] = useState<ClusterResponse | null>(null);
  const [minus, setMinus] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [bidDraft, setBidDraft] = useState<Record<string, string>>({});

  const open = async (row: CampaignRow) => {
    setSelected(row);
    setLoading(true);
    setError(null);
    setData(null);
    const [clusters, minusResult] = await Promise.all([
      adGet<ClusterResponse>(`/api/adverts/clusters?cabinet=${cabinetId}&advertId=${row.campaign.id}&nmId=${row.nm}`),
      adGet<{ phrases: string[] }>(`/api/adverts/minus?cabinet=${cabinetId}&advertId=${row.campaign.id}&nmId=${row.nm}`),
    ]);
    setLoading(false);
    if (!clusters.ok) {
      setError(clusters.error);
      return;
    }
    setData(clusters.data);
    setMinus(minusResult.ok ? minusResult.data?.phrases ?? [] : []);
  };

  const applyMinus = (mode: "add" | "remove", phrases: string[]) => {
    if (!selected || !phrases.length) return;
    onAsk({
      actionId: "minus",
      subject: `${selected.campaign.name} · ${selected.art}`,
      detail:
        mode === "add"
          ? `Добавится ${phrases.length} фраз к ${minus.length} уже заданным. Сервер сначала читает текущий набор, поэтому существующие фразы не потеряются.`
          : `Уберётся ${phrases.length} фраз из ${minus.length}.`,
      run: async () => {
        const result = await adPost<{ phrases: string[] }>("/api/adverts/minus", {
          cabinetId,
          advertId: selected.campaign.id,
          nmId: selected.nm,
          mode,
          phrases,
        });
        if (result.ok) {
          setMinus(result.data?.phrases ?? []);
          setDraft("");
        }
        return { ok: result.ok, error: result.error };
      },
    });
  };

  if (!manual.length) {
    return (
      <WbEmptyState>
        Нет кампаний с ручной ставкой. Кластерами и минус-фразами WB управляет только в них: у единой ставки и запросы, и места
        выбирает алгоритм.
      </WbEmptyState>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Кампании с ручной ставкой
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          {manual.map((row) => (
            <button
              key={`${row.campaign.id}-${row.nm}`}
              type="button"
              onClick={() => void open(row)}
              className={`block w-full border-b border-slate-50 px-3 py-2 text-left text-[12px] transition-colors last:border-0 ${selected?.campaign.id === row.campaign.id && selected?.nm === row.nm ? "bg-violet-50" : "hover:bg-slate-50"}`}
            >
              <div className="font-semibold text-slate-800">{row.campaign.name}</div>
              <div className="text-[10px] text-slate-400">
                {row.art} · {row.nm}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {!selected ? (
          <WbEmptyState>Выберите кампанию слева.</WbEmptyState>
        ) : loading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">Читаю кластеры…</div>
        ) : error ? (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{error}</div>
        ) : data ? (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Активные кластеры</div>
              <p className="mt-0.5 text-[11px] text-slate-400">{data.note}</p>
              {data.bidsError ? (
                <p className="mt-1 text-[11px] text-amber-700">Ставки прочитаны не полностью: {data.bidsError}</p>
              ) : null}
              {data.active.length === 0 ? (
                <p className="mt-2 text-[12px] text-slate-500">
                  Пока пусто. Это значит «ещё не набралось 100 показов», а не «запросов нет».
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  {data.active.map((cluster) => (
                    <div key={cluster.query} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                      <span className="min-w-0 flex-1 basis-full truncate text-[12px] text-slate-700 sm:basis-auto">{cluster.query}</span>
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {cluster.bid == null ? "ставка кампании" : `${cluster.bid} ${currency}`}
                      </span>
                      <input
                        value={bidDraft[cluster.query] ?? ""}
                        onChange={(event) => setBidDraft((prev) => ({ ...prev, [cluster.query]: event.target.value }))}
                        inputMode="numeric"
                        placeholder="своя"
                        className="min-h-11 w-20 rounded border border-slate-300 px-1.5 text-[11px] tabular-nums focus:border-violet-500 focus:outline-none lg:min-h-7 lg:w-16"
                      />
                      <button
                        type="button"
                        className="min-h-11 rounded bg-slate-800 px-3 text-[10px] font-semibold text-white lg:min-h-7 lg:px-2"
                        onClick={() => {
                          const bid = Number(bidDraft[cluster.query]);
                          if (!Number.isFinite(bid) || bid <= 0) return;
                          onAsk({
                            actionId: "cluster_bid",
                            subject: `${selected.campaign.name} · «${cluster.query}»`,
                            detail: `Ставка на этот кластер станет ${bid} ${currency}. Остальные кластеры кампании не затрагиваются.`,
                            run: async () => {
                              const result = await adPost("/api/adverts/clusters", {
                                cabinetId,
                                advertId: selected.campaign.id,
                                nmId: selected.nm,
                                bids: [{ query: cluster.query, bid }],
                              });
                              if (result.ok) void open(selected);
                              return { ok: result.ok, error: result.error };
                            },
                          });
                        }}
                      >
                        Ставка
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Минус-фразы · {minus.length}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                WB хранит набор целиком, поэтому здесь только «добавить» и «убрать»: слияние делает сервер, прочитав текущий список.
              </p>
              <div className="mt-2 flex gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                  placeholder="Фразы через запятую или с новой строки"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] focus:border-violet-500 focus:outline-none"
                />
                <button
                  type="button"
                  className="h-9 self-start rounded-lg bg-slate-800 px-3 text-[11px] font-semibold text-white"
                  onClick={() => applyMinus("add", draft.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))}
                >
                  Добавить
                </button>
              </div>
              {minus.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {minus.map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      title="Убрать из минус-фраз"
                      onClick={() => applyMinus("remove", [phrase])}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                    >
                      {phrase} ✕
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {data.excluded.length ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Исключённые WB · {data.excluded.length}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {data.excluded.map((cluster) => (
                    <span key={cluster.query} className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
                      {cluster.query}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
