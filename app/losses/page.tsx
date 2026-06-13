"use client";

import { useEffect, useState } from "react";
import { TrendingDown, Loader2, Info } from "lucide-react";

interface LossItem { key: string; label: string; rub: number; tip: string }
interface LossData {
  period: { from: string; to: string; weeks: number };
  retail: number; payout: number; commission: number; returns: number;
  totalDeductions: number; items: LossItem[]; error?: string; noCabinet?: boolean;
  serviceItems?: { name: string; rub: number }[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const COLORS = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-yellow-500", "bg-lime-500", "bg-violet-400", "bg-pink-400", "bg-gray-400", "bg-slate-400"];

export default function LossesPage() {
  const [weeks, setWeeks] = useState(4);
  const [mp, setMp] = useState<"wb" | "ozon">("wb");
  const [data, setData] = useState<LossData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loc, setLoc] = useState<{ localizationPct: number; il: number; irp: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    const url = mp === "ozon" ? `/api/ozon/losses?weeks=${weeks}` : `/api/wb/losses?weeks=${weeks}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [weeks, mp]);
  useEffect(() => {
    fetch("/api/supplies/localization").then((r) => r.json()).then(setLoc).catch(() => {});
  }, []);

  const max = data?.items?.[0]?.rub || 1;
  const dedPct = data && data.retail > 0 ? Math.round((data.totalDeductions / data.retail) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600">
          <TrendingDown className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Где теряем деньги</h1>
          <p className="text-sm text-gray-500">{mp === "ozon" ? "Удержания Ozon (finance/transaction)" : "Удержания WB из финотчёта-детализации (reportDetailByPeriod)"}</p>
        </div>
        <div className="mr-2 flex gap-1 rounded-lg bg-gray-100 p-0.5">
          <button onClick={() => setMp("wb")} className={`rounded px-3 py-1 text-xs font-semibold ${mp === "wb" ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>WB</button>
          <button onClick={() => setMp("ozon")} className={`rounded px-3 py-1 text-xs font-semibold ${mp === "ozon" ? "bg-white text-sky-700 shadow" : "text-gray-500"}`}>Ozon</button>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {[2, 4, 8].map((w) => (
            <button key={w} onClick={() => setWeeks(w)}
              className={`rounded px-3 py-1 text-xs font-semibold ${weeks === w ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}>
              {w} нед
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : data?.noCabinet ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          {data.error} → <a href="/cabinets" className="font-semibold underline">добавить Ozon-кабинет</a>
        </div>
      ) : data?.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Ошибка {mp === "ozon" ? "Ozon" : "WB"}: {data.error}</div>
      ) : !data ? (
        <div className="py-16 text-center text-gray-400">Нет данных</div>
      ) : (
        <>
          {/* Сводка */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Выручка</div>
              <div className="text-xl font-bold text-gray-900">{fmt(data.retail)} ₽</div>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Удержано WB</div>
              <div className="text-xl font-bold text-red-600">{fmt(data.totalDeductions)} ₽</div>
              <div className="text-[11px] text-red-400">{dedPct}% от выручки</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">К перечислению</div>
              <div className="text-xl font-bold text-emerald-700">{fmt(data.payout)} ₽</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Возвраты</div>
              <div className="text-xl font-bold text-gray-700">{fmt(data.returns)} ₽</div>
            </div>
          </div>

          {/* Разбивка удержаний */}
          <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 text-sm font-semibold text-gray-700">Куда ушли деньги — {data.period.from} → {data.period.to}</div>
            <div className="space-y-2.5">
              {data.items.map((it, i) => (
                <div key={it.key} className="flex items-center gap-3" title={it.tip}>
                  <div className="w-56 shrink-0 text-sm text-gray-700">{it.label}</div>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                    <div className={`h-full ${COLORS[i % COLORS.length]}`} style={{ width: `${Math.max(2, (it.rub / max) * 100)}%` }} />
                  </div>
                  <div className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">{fmt(it.rub)} ₽</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Реклама в удержаниях — это автосписания «WB Продвижение» через финотчёт, помимо того, что видно в рекламном кабинете. Часто самая большая статья.
            </div>
          </div>

          {/* Логистика / локализация — связка (только WB) */}
          {mp === "wb" && loc && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-1 text-sm font-semibold text-gray-700">Логистику можно снизить локализацией</div>
              <div className="text-sm text-gray-500">
                Текущая локализация <b className={loc.localizationPct >= 60 ? "text-emerald-600" : "text-amber-600"}>{loc.localizationPct}%</b> ·
                ИЛ (множитель логистики) <b>{loc.il}</b> · ИРП <b className={loc.irp === 0 ? "text-emerald-600" : "text-red-600"}>{loc.irp}%</b>.
                Чем выше локализация — тем ниже логистика. Раскладку «что грузить» смотри в разделе <a href="/inferno/wb.html" className="text-violet-600 hover:underline">Поставки</a>.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
