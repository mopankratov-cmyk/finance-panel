"use client";
/* eslint-disable @next/next/no-img-element -- variant URLs are user-selected WB/external test assets */

import { AlertTriangle, ArrowLeft, Download, CheckCircle2, ExternalLink, Loader2, Pause, Play, RotateCcw, Square, Trophy, XCircle } from "lucide-react";
import { useState } from "react";
import { ctrLeaderVerdict } from "@/lib/ctrtest/model";
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
  /**
   * Идущий раунд тоже считается.
   *
   * Итоги раунда записываются в момент его ЗАКРЫТИЯ, а накопленные суммы
   * варианта складываются только из закрытых. Пока первый раунд идёт — а при
   * цели в тысячи показов это часы, — таблица показывала сплошные нули, и
   * работающий тест выглядел сломанным. Живая дельта при этом уже была на
   * странице, но только одной строкой сверху.
   *
   * Поэтому у варианта, который меряется сейчас, к накопленному прибавляется
   * дельта текущего раунда. Столбец и без того помечен «сейчас», так что
   * спутать незавершённое с итогом нельзя.
   */
  const live = test.currentLive;
  const total = (variant: CtrVariantView, key: "impressions" | "clicks" | "opens" | "carts" | "orders" | "spend") =>
    Number(variant[key] ?? 0) + (variant.id === test.currentVariantId ? Number((live as Record<string, unknown> | null)?.[key] ?? 0) : 0);

  return [
    { label: "Показов", value: (variant: CtrVariantView) => number(total(variant, "impressions")) },
    { label: "Кликов", value: (variant: CtrVariantView) => number(total(variant, "clicks")) },
    { label: "CTR", value: (variant: CtrVariantView) => total(variant, "impressions") ? `${(total(variant, "clicks") / total(variant, "impressions") * 100).toFixed(2)}%` : "—" },
    { label: "Открытий", value: (variant: CtrVariantView) => number(total(variant, "opens")) },
    { label: "Корзин", value: (variant: CtrVariantView) => number(total(variant, "carts")) },
    { label: "Заказов", value: (variant: CtrVariantView) => number(total(variant, "orders")) },
    { label: test.testType === "ctr" ? "Результат CTR" : test.testType === "cr" ? "Результат CR" : "Video proxy", value: (variant: CtrVariantView) => pct(variant.score) },
    { label: "Изменение к базе", value: (variant: CtrVariantView) => variant.resultPct == null ? "—" : `${variant.resultPct > 0 ? "+" : ""}${variant.resultPct.toFixed(2)}%` },
    // Отклонение от ЛУЧШЕГО, а не только от базы. База — это то, с чего
    // начали; лучший — то, ради чего тест. Когда вариантов больше двух,
    // «на сколько я отстаю от вожака» отвечает на вопрос «кого выключать»,
    // а «изменение к базе» — нет.
    {
      label: "Отставание от лучшего",
      value: (variant: CtrVariantView) => {
        const ctr = (v: CtrVariantView) => (total(v, "impressions") >= 50 ? total(v, "clicks") / total(v, "impressions") : null);
        const mine = ctr(variant);
        const best = test.variants.map(ctr).filter((x): x is number => x != null).sort((a, b) => b - a)[0];
        if (mine == null || best == null) return "—";
        if (mine >= best) return "лучший";
        return `${((best - mine) * 100).toFixed(2)} п.п.`;
      },
    },
    { label: "Побед в раундах", value: (variant: CtrVariantView) => `${variant.roundsWon} раз` },
    { label: "Раундов", value: (variant: CtrVariantView) => number(variant.roundsCount) },
    { label: "Расход", value: (variant: CtrVariantView) => `${number(total(variant, "spend"))} ₽` },
  ];
}

function actionConfirm(action: string, variant?: CtrVariantView, auto = false) {
  // При автоматике первый слот стартует на том, что УЖЕ стоит на карточке:
  // базовый вариант — это её текущее фото. Просить поставить его руками
  // значит просить сделать то, что и так сделано.
  if (action === "start" && auto) {
    return window.confirm(`Запустить тест? Первым откручивается «${variant?.label ?? "базовый вариант"}» — фото, которое сейчас стоит на карточке. Дальше панель переставит варианты сама.`);
  }
  if (action === "start" || action === "advance") return window.confirm(`Сначала вручную установите «${variant?.label ?? "выбранный вариант"}» в карточке/кампании WB. Контент уже установлен и можно зафиксировать начало слота?`);
  if (action === "finish") return window.confirm("Завершить тест и выбрать победителя по накопленным метрикам?");
  if (action === "cancel") return window.confirm("Отменить тест? История и метрики останутся в журнале.");
  if (action === "winner") return window.confirm(`Выбрать «${variant?.label}» победителем вручную и завершить тест?`);
  return true;
}


/**
 * Картинка варианта, переживающая мёртвый адрес.
 *
 * У базового варианта ссылка на обложку записывалась формулой баскета, а она
 * протухает при каждой разрезке у WB: на тесте HT-83-26 в базе лежит
 * basket-48, а карточка на basket-47 — по адресу 404 и битая картинка вместо
 * «Текущего фото». Новые тесты пишут проверенный адрес, но у заведённых он уже
 * неверный, и экран обязан оставаться читаемым: подпись честнее пустого
 * прямоугольника с иконкой поломки.
 */
function VariantImage({ url, label }: { url: string; label: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span
        title={url ? "Файл по этому адресу не открывается" : "У варианта нет ссылки"}
        className="grid aspect-[3/4] w-full place-items-center rounded-md bg-slate-100 px-1 text-center text-[9px] font-semibold leading-3 text-slate-500"
      >
        {label}
        <span className="mt-1 font-normal text-slate-400">фото не открылось</span>
      </span>
    );
  }
  /* Обложка показывается ЦЕЛИКОМ, без обрезки, и в пропорции карточки WB (3:4).
   Прежние `h-28 object-cover` и `aspect-[4/3]` срезали верх вертикального
   фото — то есть ровно лицо и композицию. На экране, где человек выбирает
   между обложками, это отнимает предмет выбора: сравнивались куртки по
   подолу. `object-contain` показывает кадр полностью даже когда пропорция
   у варианта своя. */
  return <img src={url} alt="" onError={() => setBroken(true)} className="aspect-[3/4] w-full rounded-md bg-slate-50 object-contain" />;
}

export function CtrTestDetail({ test, busy, onBack, onAction, onFlywheel }: Props) {
  const current = test.variants.find((variant) => variant.id === test.currentVariantId) ?? null;
  const latestRound = [...test.rounds].sort((a, b) => b.round_number - a.round_number)[0];
  const lastVariant = test.variants.find((variant) => variant.id === latestRound?.variant_id);
  const nextPosition = ((current ?? lastVariant)?.position ?? -1) + 1;
  const next = test.variants.find((variant) => variant.position === nextPosition) ?? test.variants[0];
  const winner = test.variants.find((variant) => variant.id === test.winnerVariantId || variant.isWinner) ?? null;
  // Вердикт считается по тем же числам, что видит человек в таблице, — то есть
  // с учётом идущего раунда: иначе строка и таблица расходились бы.
  const liveOf = (variant: CtrVariantView, key: "impressions" | "clicks") =>
    Number(variant[key] ?? 0) + (variant.id === test.currentVariantId ? Number((test.currentLive as Record<string, unknown> | null)?.[key] ?? 0) : 0);
  const verdict = ctrLeaderVerdict(test.variants.map((variant) => ({
    label: variant.label,
    impressions: liveOf(variant, "impressions"),
    clicks: liveOf(variant, "clicks"),
  })));

  const spent = test.variants.reduce((sum, variant) => sum + variant.spend, 0) + Number(test.currentLive?.spend ?? 0);
  const spentPct = Math.min(100, test.spendCapRub > 0 ? spent / test.spendCapRub * 100 : 0);

  const trigger = (action: string, variant?: CtrVariantView) => {
    if (!actionConfirm(action, variant, test.liveSwapEnabled)) return;
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
            {test.status === "running" && next && !test.liveSwapEnabled ? <button type="button" disabled={busy} onClick={() => trigger("advance", next)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Следующий: {next.label}</button> : null}
            {test.status === "running" ? <button type="button" disabled={busy} onClick={() => onAction("pause")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-200 px-3 text-[11px] font-semibold text-amber-700 disabled:opacity-50"><Pause className="h-3.5 w-3.5" />Пауза</button> : null}
            {test.status !== "done" && test.status !== "cancelled" ? <button type="button" disabled={busy} onClick={() => trigger("finish")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 disabled:opacity-50"><Square className="h-3.5 w-3.5" />Стоп с победителем</button> : null}
            {/*
              Способ ротации меняется только у остановленного теста: иначе часть
              раундов окажется ручной, часть машинной, и сравнивать их не с чем.
              Кнопка говорит, что произойдёт, а не как называется флаг.
            */}
            {test.status === "draft" || test.status === "paused" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const on = !test.liveSwapEnabled;
                  if (!window.confirm(on
                    ? "Включить автоматическую смену?\n\nПанель будет сама менять главное фото карточки на витрине WB каждый раз, когда вариант наберёт норму показов. Запись в карточку необратима."
                    : "Выключить автоматическую смену? Дальше варианты ставите и подтверждаете вы.")) return;
                  onAction("auto", undefined, on ? "on" : "off");
                }}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold disabled:opacity-50 ${test.liveSwapEnabled ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-600"}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {test.liveSwapEnabled ? "Меняет сама" : "Менять автоматически"}
              </button>
            ) : null}
            {test.status !== "done" && test.status !== "cancelled" ? <button type="button" disabled={busy} onClick={() => trigger("cancel")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[11px] font-semibold text-rose-600 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Отменить</button> : null}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {[['Раунд', test.roundNum], ['Интервал', `${test.intervalMin} мин`], ['Цель', `${number(test.targetImpressions)} показов`], ['Режим', test.liveSwapEnabled ? 'меняет сама' : 'ручная ротация']].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><div className="text-[9px] uppercase text-slate-400">{label}</div><div className="mt-1 text-xs font-bold text-slate-700">{value}</div></div>)}
        </div>
        <div className="mt-3"><div className="flex justify-between text-[10px] text-slate-500"><span>Расход теста</span><span>{number(spent)} / {number(test.spendCapRub)} ₽</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${spentPct >= 100 ? "bg-rose-500" : "bg-violet-500"}`} style={{ width: `${spentPct}%` }} /></div></div>
        {test.liveSwapEnabled && test.autoError ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
            Последняя попытка смены не прошла: {test.autoError}. Тест стоит на прежнем варианте — ротация повторит попытку.
          </div>
        ) : null}
        {current ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-[11px] text-violet-800"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /><span>Сейчас измеряется: <b>{current.label}</b></span><span className="text-violet-500">live +{number(Number(test.currentLive?.impressions ?? 0))} показов · +{number(Number(test.currentLive?.clicks ?? 0))} кликов</span><a href={current.imageUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-1 font-semibold hover:underline">Открыть контент <ExternalLink className="h-3.5 w-3.5" /></a></div> : null}
      </section>

      {winner ? <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-start gap-3"><Trophy className="mt-0.5 h-5 w-5 text-emerald-600" /><div><h3 className="text-sm font-bold text-emerald-900">Победитель: {winner.label}</h3><p className="mt-1 text-xs leading-5 text-emerald-800">{test.winnerExplanation || "Победитель зафиксирован в журнале теста."}</p></div><button type="button" onClick={() => onFlywheel(winner)} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white"><RotateCcw className="h-3.5 w-3.5" />Маховик: новый тест</button></div></section> : null}

      <section>
        <h3 className="mb-2 text-xs font-bold text-slate-700">Тестирование</h3>
        {/* Главный вопрос экрана — «можно ли уже решать», и панель на него
            отвечает счётом, а не правилом большого пальца. Чужие сервисы
            советуют «наберите десять тысяч показов»; совет неверен по сути,
            потому что нужный объём зависит от того, насколько варианты
            разошлись: двукратный отрыв виден на тысяче, а разница в пять
            процентов не проявится и на пятидесяти тысячах. */}
        {verdict ? (
          <p className={`mb-2 rounded-lg border px-3 py-2 text-[11px] leading-5 ${verdict.decisive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            {verdict.text}
          </p>
        ) : null}
        <div className="scroll-x rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[760px] w-full border-collapse text-[10px]">
            <thead><tr><th className="sticky left-0 z-10 min-w-[190px] border-b border-r border-slate-200 bg-slate-50" />{test.variants.map((variant) => <th key={variant.id} className="min-w-[150px] border-b border-slate-200 p-2"><div className={`relative rounded-lg border p-2 ${variant.id === test.currentVariantId ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : variant.isWinner ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 bg-slate-50"}`}>{variant.id === test.currentVariantId ? <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-2 py-0.5 text-[8px] text-white">сейчас</span> : null}{variant.isWinner ? <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-2 py-0.5 text-[8px] text-white">победитель</span> : null}{test.testType === "video" ? <video src={variant.imageUrl} controls muted preload="metadata" className="aspect-[3/4] w-full rounded-md bg-slate-50 object-contain" /> : <VariantImage url={variant.imageUrl} label={variant.label} />}<div className="mt-1 flex items-center justify-center gap-1"><span className="truncate text-[10px] font-semibold text-slate-700">{variant.label}</span>{variant.imageUrl ? <a href={variant.imageUrl} download target="_blank" rel="noreferrer" aria-label={`Скачать «${variant.label}»`} className="tap-hit shrink-0 text-slate-400 transition-colors hover:text-violet-600"><Download className="h-3 w-3" /></a> : null}</div>{variant.isBaseline ? <div className="text-[8px] text-violet-500">база</div> : null}{test.status === "paused" && !variant.isWinner ? <button type="button" onClick={() => trigger("winner", variant)} disabled={busy} className="mt-2 min-h-11 rounded-md border border-emerald-200 px-2 text-[9px] font-semibold text-emerald-700 disabled:opacity-50">Выбрать победителем</button> : null}</div></th>)}</tr></thead>
            <tbody>{metricRows(test).map((row) => <tr key={row.label}><td className="sticky left-0 z-10 border-r border-t border-slate-200 bg-white px-3 py-2 font-medium text-slate-500">{row.label}</td>{test.variants.map((variant) => <td key={variant.id} className="border-t border-slate-100 px-3 py-2 text-center tabular-nums text-slate-700">{row.value(variant)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold text-slate-700">История раундов</h3>
        {test.rounds.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-[10px] text-slate-400">История появится после запуска первого раунда.</p> : <div className="scroll-x rounded-xl border border-slate-200 bg-white"><table className="min-w-[760px] w-full text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">Начало</th><th className="px-3 py-2 text-left">Вариант</th><th className="px-3 py-2 text-left">Статус</th><th className="px-3 py-2 text-right">Показы</th><th className="px-3 py-2 text-right">Клики</th><th className="px-3 py-2 text-right">Корзины</th><th className="px-3 py-2 text-right">Заказы</th><th className="px-3 py-2 text-left">Автор</th></tr></thead><tbody>{test.rounds.map((round) => { const variant = test.variants.find((item) => item.id === round.variant_id); return <tr key={round.id} className="border-t border-slate-100"><td className="px-3 py-2 text-slate-500">{formatTime(round.started_at)}</td><td className="px-3 py-2 font-semibold text-violet-700">{variant?.label ?? round.variant_id}</td><td className="px-3 py-2">{round.status}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.impressions ?? 0))}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.clicks ?? 0))}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.carts ?? 0))}</td><td className="px-3 py-2 text-right tabular-nums">{number(Number(round.result?.orders ?? 0))}</td><td className="px-3 py-2 text-slate-400">{round.actor ?? "—"}</td></tr>; })}</tbody></table></div>}
      </section>
      {/* Текст правится вместе с режимом: раньше здесь стояло «панель ничего не
          пишет, live_swap_enabled всегда false» — с появлением автосмены это
          стало неправдой ровно на тех тестах, где автоматика включена, и
          экран уверял в обратном. */}
      {test.liveSwapEnabled ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><b>Панель меняет фото сама.</b> Раз в пять минут проверяется, набрал ли раунд норму показов; когда набрал — обложка карточки на витрине WB переписывается следующим вариантом. Это запись в живой товар, а не пометка в панели.</span></div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-5 text-slate-500"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span><b className="text-slate-700">Без скрытых записей:</b> вариант вы ставите в кабинете сами, панель лишь отмечает момент и считает дельту реальных метрик WB.</span></div>
      )}
    </div>
  );
}
