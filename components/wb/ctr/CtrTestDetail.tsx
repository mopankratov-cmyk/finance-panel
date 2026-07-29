"use client";
/* eslint-disable @next/next/no-img-element -- variant URLs are user-selected WB/external test assets */

import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Pause, Play, RotateCcw, Square, Trophy, XCircle } from "lucide-react";
import { formatTime } from "@/lib/analytics/format";
import type { CtrTestView, CtrVariantView } from "./types";

interface Props {
  test: CtrTestView;
  busy: boolean;
  onBack: () => void;
  onAction: (action: string, variantId?: number, explanation?: string) => void;
  onFlywheel: (winner: CtrVariantView) => void;
}

const statusLabel = { draft: "черновик", running: "идёт", paused: "пауза", done: "завершён", cancelled: "отменён" } as const;
const statusClass = { draft: "bg-slate-400", running: "bg-violet-600", paused: "bg-amber-500", done: "bg-emerald-600", cancelled: "bg-rose-500" } as const;
const number = (value: number) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const pct = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}%`;

function metricRows(test: CtrTestView) {
  return [
    { label: "Показов", value: (variant: CtrVariantView) => number(variant.impressions) },
    { label: "Кликов", value: (variant: CtrVariantView) => number(variant.clicks) },
    { label: "CTR", value: (variant: CtrVariantView) => variant.impressions ? `${(variant.clicks / variant.impressions * 100).toFixed(2)}%` : "—" },
    { label: "Открытий", value: (variant: CtrVariantView) => number(variant.opens) },
    { label: "Корзин", value: (variant: CtrVariantView) => number(variant.carts) },
    { label: "Заказов", value: (variant: CtrVariantView) => number(variant.orders) },
    { label: test.testType === "ctr" ? "Результат CTR" : test.testType === "cr" ? "Результат CR" : "Video proxy", value: (variant: CtrVariantView) => pct(variant.score) },
    { label: "Изменение к базе", value: (variant: CtrVariantView) => variant.resultPct == null ? "—" : `${variant.resultPct > 0 ? "+" : ""}${variant.resultPct.toFixed(2)}%` },
    { label: "Побед в раундах", value: (variant: CtrVariantView) => `${variant.roundsWon} раз` },
    { label: "Раундов", value: (variant: CtrVariantView) => number(variant.roundsCount) },
    { label: "Расход", value: (variant: CtrVariantView) => `${number(variant.spend)} ₽` },
  ];
}

function actionConfirm(action: string, variant?: CtrVariantView) {
  if (action === "start" || action === "advance") return window.confirm(`Сначала вручную установите «${variant?.label ?? "выбранный вариант"}» в карточке/кампании WB. Контент уже установлен и можно зафиксировать начало слота?`);
  if (action === "finish") return window.confirm("Завершить тест и выбрать победителя по накопленным метрикам?");
  if (action === "cancel") return window.confirm("Отменить тест? История и метрики останутся в журнале.");
  if (action === "winner") return window.confirm(`Выбрать «${variant?.label}» победителем вручную и завершить тест?`);
  return true;
}

export function CtrTestDetail({ test, busy, onBack, onAction, onFlywheel }: Props) {
  const current = test.variants.find((variant) => variant.id === test.currentVariantId) ?? null;
  const latestRound = [...test.rounds].sort((a, b) => b.round_number - a.round_number)[0];
  const lastVariant = test.variants.find((variant) => variant.id === latestRound?.variant_id);
  const nextPosition = ((current ?? lastVariant)?.position ?? -1) + 1;
  const next = test.variants.find((variant) => variant.position === nextPosition) ?? test.variants[0];
  const winner = test.variants.find((variant) => variant.id === test.winnerVariantId || variant.isWinner) ?? null;
  const spent = test.variants.reduce((sum, variant) => sum + variant.spend, 0) + Number(test.currentLive?.spend ?? 0);
  const spentPct = Math.min(100, test.spendCapRub > 0 ? spent / test.spendCapRub * 100 : 0);

  const trigger = (action: string, variant?: CtrVariantView) => {
    if (!actionConfirm(action, variant)) return;
    onAction(action, variant?.id, action === "winner" ? "Победитель выбран владельцем после ручной проверки метрик и контента." : undefined);
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-white hover:text-violet-700"><ArrowLeft className="h-4 w-4" />К списку тестов</button>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div><h2 className="text-lg font-bold text-slate-900">{test.article}</h2><p className="text-[11px] text-slate-400">{test.name || `nm ${test.nmId}`} · nm {test.nmId}</p></div>
          <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white ${statusClass[test.status]}`}>{statusLabel[test.status]}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold uppercase text-slate-500">{test.testType}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {(test.status === "draft" || test.status === "paused") && next ? <button type="button" disabled={busy} onClick={() => trigger("start", next)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />{test.status === "draft" ? "Запустить первый слот" : `Продолжить: ${next.label}`}</button> : null}
            {test.status === "running" && next ? <button type="button" disabled={busy} onClick={() => trigger("advance", next)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Следующий: {next.label}</button> : null}
            {test.status === "running" ? <button type="button" disabled={busy} onClick={() => onAction("pause")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-200 px-3 text-[11px] font-semibold text-amber-700 disabled:opacity-50"><Pause className="h-3.5 w-3.5" />Пауза</button> : null}
            {test.status !== "done" && test.status !== "cancelled" ? <button type="button" disabled={busy} onClick={() => trigger("finish")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 disabled:opacity-50"><Square className="h-3.5 w-3.5" />Стоп с победителем</button> : null}
            {test.status !== "done" && test.status !== "cancelled" ? <button type="button" disabled={busy} onClick={() => trigger("cancel")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[11px] font-semibold text-rose-600 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Отменить</button> : null}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {[['Раунд', test.roundNum], ['Интервал', `${test.intervalMin} мин`], ['Цель', `${number(test.targetImpressions)} показов`], ['Режим', 'ручная ротация']].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><div className="text-[9px] uppercase text-slate-400">{label}</div><div className="mt-1 text-xs font-bold text-slate-700">{value}</div></div>)}
        </div>
        <div className="mt-3"><div className="flex justify-between text-[10px] text-slate-500"><span>Расход теста</span><span>{number(spent)} / {number(test.spendCapRub)} ₽</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${spentPct >= 100 ? "bg-rose-500" : "bg-violet-500"}`} style={{ width: `${spentPct}%` }} /></div></div>
        {current ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-[11px] text-violet-800"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /><span>Сейчас измеряется: <b>{current.label}</b></span><span className="text-violet-500">live +{number(Number(test.currentLive?.impressions ?? 0))} показов · +{number(Number(test.currentLive?.clicks ?? 0))} кликов</span><a href={current.imageUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-1 font-semibold hover:underline">Открыть контент <ExternalLink className="h-3.5 w-3.5" /></a></div> : null}
      </section>

      {winner ? <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-start gap-3"><Trophy className="mt-0.5 h-5 w-5 text-emerald-600" /><div><h3 className="text-sm font-bold text-emerald-900">Победитель: {winner.label}</h3><p className="mt-1 text-xs leading-5 text-emerald-800">{test.winnerExplanation || "Победитель зафиксирован в журнале теста."}</p></div><button type="button" onClick={() => onFlywheel(winner)} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white"><RotateCcw className="h-3.5 w-3.5" />Маховик: новый тест</button></div></section> : null}

      <section>
        <h3 className="mb-2 text-xs font-bold text-slate-700">Тестирование</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[760px] w-full border-collapse text-[10px]">
            <thead><tr><th className="sticky left-0 z-10 min-w-[190px] border-b border-r border-slate-200 bg-slate-50" />{test.variants.map((variant) => <th key={variant.id} className="min-w-[150px] border-b border-slate-200 p-2"><div className={`relative rounded-lg border p-2 ${variant.id === test.currentVariantId ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : variant.isWinner ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 bg-slate-50"}`}>{variant.id === test.currentVariantId ? <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-2 py-0.5 text-[8px] text-white">сейчас</span> : null}{variant.isWinner ? <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-2 py-0.5 text-[8px] text-white">победитель</span> : null}{test.testType === "video" ? <video src={variant.imageUrl} controls muted preload="metadata" className="h-28 w-full rounded-md object-cover" /> : <img src={variant.imageUrl} alt="" className="h-28 w-full rounded-md object-cover" />}<div className="mt-1 truncate text-[10px] font-semibold text-slate-700">{variant.label}</div>{variant.isBaseline ? <div className="text-[8px] text-violet-500">база</div> : null}{test.status === "paused" && !variant.isWinner ? <button type="button" onClick={() => trigger("winner", variant)} disabled={busy} className="mt-2 min-h-11 rounded-md border border-emerald-200 px-2 text-[9px] font-semibold text-emerald-700 disabled:opacity-50">Выбрать победителем</button> : null}</div></th>)}</tr></thead>
            <tbody>{metricRows(test).map((row) => <tr key={row.label}><td className="sticky left-0 z-10 border-r border-t border-slate-200 bg-white px-3 py-2 font-medium text-slate-500">{row.label}</td>{test.variants.map((variant) => <td key={variant.id} className="border-t border-slate-100 px-3 py-2 text-center tabular-nums text-slate-700">{row.value(variant)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold text-slate-700">История раундов</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-[760px] w-full text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">Начало</th><th className="px-3 py-2 text-left">Вариант</th><th className="px-3 py-2 text-left">Статус</th><th className="px-3 py-2 text-right">Показы</th><th className="px-3 py-2 text-right">Клики</th><th className="px-3 py-2 text-right">Корзины</th><th className="px-3 py-2 text-right">Заказы</th><th className="px-3 py-2 text-left">Автор</th></tr></thead><tbody>{test.rounds.length ? test.rounds.map((round) => { const variant = test.variants.find((item) => item.id === round.variant_id); return <tr key={round.id} className="border-t border-slate-100"><td className="px-3 py-2 text-slate-500">{formatTime(round.started_at)}</td><td className="px-3 py-2 font-semibold text-violet-700">{variant?.label ?? round.variant_id}</td><td className="px-3 py-2">{round.status}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.impressions ?? 0))}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.clicks ?? 0))}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.carts ?? 0))}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.orders ?? 0))}</td><td className="px-3 py-2 text-slate-400">{round.actor ?? "—"}</td></tr>; }) : <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">История появится после запуска первого раунда.</td></tr>}</tbody></table></div>
      </section>
      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-5 text-slate-500"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span><b className="text-slate-700">Без скрытых write-действий:</b> панель фиксирует момент ручной установки варианта и считает дельту реальных WB-метрик. `live_swap_enabled` всегда false.</span></div>
    </div>
  );
}
