"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { formatNumber } from "@/lib/analytics/format";
import { UNRELIABLE_WINDOWS, historyLines, type HistoryLine, type HistoryPoint } from "@/lib/supplies/stockHistory";
import type { StockCatalogRow } from "@/app/api/supplies/route";

/**
 * История остатка артикула: график и таблица по дням.
 *
 * Считается по тем же складам, что выбраны в фильтре: остаток «по выбранным
 * складам» сегодня и остаток «по выбранным складам» месяц назад — одна и та же
 * величина, а не общий итог рядом с частным.
 */

const PERIODS = [7, 30, 90] as const;

interface HistoryResponse {
  data: { points: HistoryPoint[]; journal: boolean; retentionDays: number } | null;
  error: string | null;
}

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" });
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatNumber(Math.abs(value))}`;

interface ChartPoint { t: number; value: number; label: string }

/** График остатка. Свой SVG: точек десятки, и целая библиотека графиков ради одной линии не нужна. */
export function StockChart({ points }: { points: ChartPoint[] }) {
  const W = 640, H = 190, PL = 44, PR = 12, PT = 12, PB = 26;
  if (points.length === 0) return null;
  const t0 = Math.min(...points.map((point) => point.t));
  const t1 = Math.max(...points.map((point) => point.t));
  const max = Math.max(1, ...points.map((point) => point.value));
  const x = (t: number) => PL + (t1 === t0 ? (W - PL - PR) / 2 : ((t - t0) / (t1 - t0)) * (W - PL - PR));
  const y = (value: number) => PT + (1 - value / max) * (H - PT - PB);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];

  // Периоды, когда снимки заведомо врут, закрашены: провал «до нуля» в них — сбой источника, а не распродажа.
  const bands = UNRELIABLE_WINDOWS.flatMap((window) => {
    const from = Date.parse(`${window.from}T00:00:00Z`);
    const to = Date.parse(`${window.to}T23:59:59Z`);
    if (to < t0 || from > t1) return [];
    return [{ x1: x(Math.max(from, t0)), x2: x(Math.min(to, t1)), note: window.note }];
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Остаток с ${first.label} по ${last.label}: от ${formatNumber(first.value)} до ${formatNumber(last.value)} шт, максимум ${formatNumber(max)}`}>
      {bands.map((band, index) => (
        <rect key={index} x={band.x1} y={PT} width={Math.max(2, band.x2 - band.x1)} height={H - PT - PB} className="fill-amber-100" opacity={0.7} />
      ))}
      {[0, 0.5, 1].map((share) => (
        <g key={share}>
          <line x1={PL} x2={W - PR} y1={y(max * share)} y2={y(max * share)} className="stroke-slate-200" strokeWidth={1} />
          <text x={PL - 6} y={y(max * share) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>{formatNumber(Math.round(max * share))}</text>
        </g>
      ))}
      <path d={path} fill="none" className="stroke-violet-600" strokeWidth={2} strokeLinejoin="round" />
      {points.map((point, index) => <circle key={index} cx={x(point.t)} cy={y(point.value)} r={points.length > 45 ? 1.5 : 3} className="fill-violet-600" />)}
      <text x={PL} y={H - 8} className="fill-slate-400" fontSize={10}>{first.label}</text>
      <text x={W - PR} y={H - 8} textAnchor="end" className="fill-slate-400" fontSize={10}>{last.label}</text>
    </svg>
  );
}

export type HistoryData = { points: HistoryPoint[]; journal: boolean; retentionDays: number };

/**
 * Содержимое панели без загрузки: состояние приходит готовым. Так экран можно
 * отрисовать и проверить на любых данных, не поднимая сеть.
 */
export function StockHistoryView({
  row,
  selected,
  days,
  onDays,
  ready,
  error,
  data,
}: {
  /** Строка каталога уже с учётом фильтра по складам: quantity — остаток по выбранным складам. */
  row: StockCatalogRow;
  selected: ReadonlySet<string> | null;
  days: number;
  onDays: (days: (typeof PERIODS)[number]) => void;
  ready: boolean;
  error: string | null;
  data: HistoryData | null;
}) {
  const lines = useMemo<HistoryLine[]>(() => (data && ready ? historyLines(data.points, selected) : []), [data, ready, selected]);
  const lastTotal = lines.length ? lines[lines.length - 1].total : null;
  // Последняя точка — «сейчас», из самого каталога: снимок мог быть сделан несколько часов назад.
  // Место на оси — конец последних суток, а не Date.now(): в отрисовке время не читается,
  // а сдвиг на полсуток на графике за неделю и больше незаметен.
  const lastAt = lines.length ? Date.parse(`${lines[lines.length - 1].date}T12:00:00Z`) : 0;
  const chart: ChartPoint[] = [
    ...lines.map((line) => ({ t: Date.parse(`${line.date}T12:00:00Z`), value: line.total, label: day(line.date) })),
    { t: lastAt + 12 * 3_600_000, value: row.quantity, label: "сейчас" },
  ];
  const first = lines[0];
  const values = chart.map((point) => point.value);
  const unreliableNote = lines.find((line) => line.unreliable)?.unreliable;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((period) => (
          <button key={period} type="button" onClick={() => onDays(period)} aria-pressed={days === period}
            className={`min-h-11 rounded-full border px-4 text-sm lg:min-h-0 lg:py-1 ${days === period ? "border-violet-500 bg-violet-600 font-semibold text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {period} дн.
          </button>
        ))}
        <span className="text-xs text-slate-500">
          {selected === null ? "по всем складам" : `по выбранным складам: ${selected.size}`}
        </span>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!ready && !error ? <p className="py-10 text-center text-sm text-slate-400">Загружаем историю…</p> : null}

      {ready && !error ? (
        lines.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            За {days} дн. снимков по этому артикулу нет. Остаток сохраняется снимком раз в четыре часа и хранится {data?.retentionDays ?? 90} дней; артикул без остатка в снимок не попадает, поэтому его история начинается с первого дня, когда товар появился на складах.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ["Сейчас", `${formatNumber(row.quantity)} шт`],
                [`${first ? day(first.date) : "—"}`, `${formatNumber(first?.total ?? 0)} шт`],
                ["Изменение", first ? signed(row.quantity - first.total) : "—"],
                ["Минимум / максимум", `${formatNumber(Math.min(...values))} / ${formatNumber(Math.max(...values))}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[10px] uppercase text-slate-400">{label}</div>
                  <div className="mt-1 text-sm font-bold tabular-nums text-slate-800">{value}</div>
                </div>
              ))}
            </div>

            <StockChart points={chart} />

            {unreliableNote ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Жёлтым закрашен период, за который снимки остатков ненадёжны: {unreliableNote}. Провал до нуля внутри него — не распродажа, а сбой источника; восстановить эти дни нельзя.
              </p>
            ) : null}
            {data && !data.journal ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                Журнал запусков крона недоступен: день без снимка по артикулу нельзя отличить от дня с нулевым остатком, поэтому пустые дни пропущены.
              </p>
            ) : null}

            <div className="scroll-x rounded-xl border border-slate-200">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Дата</th>
                    <th className="px-3 py-2 text-right">Остаток</th>
                    <th className="px-3 py-2 text-right">К предыдущему</th>
                    <th className="px-3 py-2 text-right">В пути к клиенту</th>
                    <th className="px-3 py-2 text-left">Склады</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100 bg-violet-50/50 font-semibold">
                    <td className="px-3 py-2">сейчас</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{lastTotal == null ? "—" : signed(row.quantity - lastTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.inWayToClient)}</td>
                    <td className="px-3 py-2 font-normal text-slate-500">{row.topWarehouses.slice(0, 3).map((entry) => `${entry.warehouse} ${formatNumber(entry.quantity)}`).join(" · ") || "—"}</td>
                  </tr>
                  {[...lines].reverse().map((line) => (
                    <tr key={line.date} className={`border-t border-slate-100 ${line.unreliable ? "bg-amber-50/60" : ""}`}>
                      <td className="px-3 py-2">{day(line.date)}{line.unreliable ? <span className="ml-1 text-[10px] text-amber-700">ненадёжно</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(line.total)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${line.delta == null ? "text-slate-300" : line.delta < 0 ? "text-rose-600" : line.delta > 0 ? "text-emerald-600" : "text-slate-400"}`}>{line.delta == null ? "—" : signed(line.delta)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatNumber(line.inWayToClient)}</td>
                      <td className="px-3 py-2 text-slate-500">{line.top.map((entry) => `${entry.warehouse} ${formatNumber(entry.quantity)}`).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] leading-5 text-slate-400">
              В таблице — последний снимок каждых суток по Москве. Снимки делаются раз в четыре часа и хранятся {data?.retentionDays ?? 90} дней. «В пути к клиенту» WB не делит по складам, поэтому оно по всему артикулу и от фильтра не зависит.
            </p>
          </>
        )
      ) : null}
    </div>
  );
}

export function StockHistoryPanel({
  row,
  selected,
  cabinet,
  onClose,
}: {
  row: StockCatalogRow | null;
  selected: ReadonlySet<string> | null;
  cabinet: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [state, setState] = useState<{ key: string; loading: boolean; error: string | null; data: HistoryData | null }>({ key: "", loading: false, error: null, data: null });
  const nmId = row?.nmId ?? null;
  const key = nmId == null ? "" : `${cabinet}:${nmId}:${days}`;

  useEffect(() => {
    if (nmId == null) return;
    const controller = new AbortController();
    setState({ key, loading: true, error: null, data: null });
    fetch(`/api/supplies/stock-history?cabinet=${encodeURIComponent(cabinet)}&nm=${nmId}&days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as HistoryResponse | null;
        if (!response.ok || !json?.data) throw new Error(json?.error ?? `Не удалось загрузить историю (${response.status})`);
        setState({ key, loading: false, error: null, data: json.data });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, loading: false, error: cause instanceof Error ? cause.message : "Не удалось загрузить историю", data: null });
      });
    return () => controller.abort();
  }, [cabinet, days, key, nmId]);

  return (
    <SlidePanel open={row !== null} onClose={onClose} title={row ? `История остатка · ${row.article || row.nmId}` : "История остатка"} wide>
      {row ? (
        <StockHistoryView
          row={row}
          selected={selected}
          days={days}
          onDays={setDays}
          ready={state.key === key && !state.loading}
          error={state.key === key ? state.error : null}
          data={state.key === key ? state.data : null}
        />
      ) : null}
    </SlidePanel>
  );
}
