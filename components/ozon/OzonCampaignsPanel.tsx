"use client";

import { ExternalLink, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useOzonCabinet } from "./OzonCabinetContext";
import { formatMoney, formatNumber } from "./OzonUi";

interface Campaign {
  id: string;
  title: string;
  stateLabel: string;
  running: boolean;
  advObjectType: string;
  dailyBudget: number | null;
  budget: number | null;
  fromDate: string | null;
  toDate: string | null;
  cabinet: string;
}

interface CampaignsData {
  scope: { label: string; count: number };
  summary: { total: number; running: number; dailyBudget: number };
  rows: Campaign[];
  warnings: string[];
}

/**
 * Кампании кабинета рядом с рекомендациями.
 *
 * Рекомендацию «снизить на 30%» до сих пор было не на что применить: экран
 * знал расход по товарам, но не знал, какие кампании его тратят. Ставки и
 * бюджеты Ozon через API менять не даёт, поэтому кнопка ведёт в кабинет —
 * зато менеджер видит, куда именно идти, и что там сейчас работает.
 */
export function OzonCampaignsPanel() {
  const { cabinetId, ready } = useOzonCabinet();
  const [data, setData] = useState<CampaignsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !cabinetId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/ozon/campaigns?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as CampaignsData & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить кампании");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, ready]);

  if (loading && !data) {
    return <div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white" />;
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        Кампании не загрузились: {error}
      </div>
    );
  }
  if (!data) return null;

  const visible = open ? data.rows : data.rows.slice(0, 6);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <Megaphone className="h-4 w-4 text-sky-600" />
        <div>
          <h2 className="text-sm font-bold text-slate-900">Кампании кабинета</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Работает {formatNumber(data.summary.running)} из {formatNumber(data.summary.total)}
            {data.summary.dailyBudget > 0 ? ` · дневной бюджет ${formatMoney(data.summary.dailyBudget)}` : ""}
          </p>
        </div>
        <a
          href="https://performance.ozon.ru/campaign"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-sky-700 hover:bg-sky-50 sm:min-h-8"
        >
          Открыть в Ozon <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {data.rows.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          Кампаний нет{data.warnings.length ? `: ${data.warnings[0]}` : "."}
        </div>
      ) : (
        <>
          <div className="scroll-x">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Кампания</th>
                  {data.scope.count > 1 && <th className="px-3 py-2 text-left">Кабинет</th>}
                  <th className="px-3 py-2 text-left">Статус</th>
                  <th className="px-3 py-2 text-right">Бюджет в день</th>
                  <th className="px-3 py-2 text-right">Бюджет всего</th>
                  <th className="px-4 py-2 text-left">Период</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                    <td className="px-4 py-2">
                      <div className="max-w-[320px] truncate font-semibold text-slate-800" title={row.title}>{row.title}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">ID {row.id}{row.advObjectType ? ` · ${row.advObjectType}` : ""}</div>
                    </td>
                    {data.scope.count > 1 && <td className="px-3 py-2 text-slate-600">{row.cabinet}</td>}
                    <td className="px-3 py-2">
                      <span className={`rounded-md px-1.5 py-1 text-[10px] font-semibold ${row.running ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {row.stateLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.dailyBudget == null ? "—" : formatMoney(row.dailyBudget)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.budget == null ? "—" : formatMoney(row.budget)}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500">
                      {row.fromDate ? `${row.fromDate}${row.toDate ? ` — ${row.toDate}` : " — без даты окончания"}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length > 6 && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="min-h-11 w-full border-t border-slate-100 px-4 text-xs font-semibold text-sky-700 hover:bg-slate-50 sm:min-h-9"
            >
              {open ? "Свернуть" : `Показать все ${formatNumber(data.rows.length)}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
