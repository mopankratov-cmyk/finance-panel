"use client";
/* eslint-disable @next/next/no-img-element -- variant URLs are user-selected WB/external test assets */

import { AlertTriangle, ArrowLeft, Download, CheckCircle2, ExternalLink, Hourglass, Loader2, Pause, Play, RotateCcw, Square, Trophy, XCircle } from "lucide-react";
import { useState } from "react";
import { ctrGapVerdict, ctrLeaderVerdict } from "@/lib/ctrtest/model";
import { CTR_MIN_VIEWS } from "@/lib/wb/ctrQuality";
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

/**
 * Таблица как приборная панель, а не как ведомость.
 *
 * Сравнение обложек — работа взгляда, а не чтения. Пока все метрики набраны
 * одинаковым десятым кеглем, глазу приходится обходить каждую клетку и
 * держать в голове, где чей столбец. Здесь три средства, и все три несут
 * смысл, а не украшают:
 *
 * ЦВЕТ СТОЛБЦА — кто есть кто: изумрудный вожак, фиолетовый тот, что
 * меряется прямо сейчас, остальные серые. Один цвет ведёт столбец сверху
 * донизу, и взгляд не сползает на соседний вариант.
 * ПОЛОСА В КЛЕТКЕ — величина относительно лучшего в строке. «986 показов»
 * рядом с «7 949» — это не два числа, это полоска в ноготь против полной, и
 * недобор выборки виден раньше, чем прочитан.
 * КЕГЛЬ — CTR вынесен в шапку крупно, к самой обложке: ради него всё. Прочее
 * остаётся мелким справочным слоем и не спорит с ним за внимание.
 *
 * Тон отставания отдельно: КРАСНЫЙ — разрыв больше различимого на этой
 * выборке, в нём можно быть уверенным; ЯНТАРНЫЙ — вариант позади, но разница
 * ещё внутри погрешности и может оказаться шумом; ИЗУМРУДНЫЙ — впереди.
 */
type Tone = "good" | "warn" | "bad" | "lead" | "ahead" | "muted" | "neutral";
/**
 * Роль столбца — она же его цвет.
 *
 * «lead» и «ahead» разведены намеренно: сплошной изумруд означает
 * доказанное превосходство, а бледный — «впереди, но разрыв ещё внутри
 * погрешности». Красить их одинаково значило бы объявлять победу до того,
 * как она измерена, — ровно то враньё, ради запрета которого экран и считает
 * порог различимости.
 */
type Role = "lead" | "ahead" | "current" | "plain";
interface Cell { text: string; tone?: Tone; arrow?: "up" | "down" }
interface Row { group: string; label: string; cell: (variant: CtrVariantView) => Cell; value?: (variant: CtrVariantView) => number }

const TONE_CHIP: Record<Tone, string> = {
  lead: "bg-emerald-600 text-white shadow-sm shadow-emerald-200",
  ahead: "bg-white text-emerald-700 ring-1 ring-inset ring-emerald-300",
  good: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
  muted: "text-slate-400",
  neutral: "text-slate-700",
};
const TONE_TEXT: Record<Tone, string> = {
  lead: "text-emerald-700",
  ahead: "text-emerald-600",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-600",
  muted: "text-slate-300",
  neutral: "text-slate-700",
};
const ROLE_BAR: Record<Role, string> = { lead: "bg-emerald-500", ahead: "bg-emerald-300", current: "bg-violet-500", plain: "bg-slate-300" };
const ROLE_COLUMN: Record<Role, string> = { lead: "bg-emerald-50/70", ahead: "bg-emerald-50/40", current: "bg-violet-50/70", plain: "" };
const ROLE_CARD: Record<Role, string> = {
  lead: "border-emerald-300 bg-white ring-2 ring-emerald-100",
  ahead: "border-emerald-200 bg-white ring-1 ring-emerald-50",
  current: "border-violet-300 bg-white ring-2 ring-violet-100",
  plain: "border-slate-200 bg-white",
};

function metricRows(test: CtrTestView, verdict: ReturnType<typeof ctrLeaderVerdict>) {
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
  const ctrOf = (v: CtrVariantView) => (total(v, "impressions") >= CTR_MIN_VIEWS ? total(v, "clicks") / total(v, "impressions") : null);
  /**
   * Главная доля — та, по которой тест и решается.
   *
   * У ctr-теста это клики к показам, у cr — корзины к открытиям, у video —
   * заказы к открытиям (ctrVariantScore в модели, оно же и в SQL, которая
   * выбирает победителя). Пока крупным числом на карточке стоял CTR
   * независимо от типа, экран CR-теста показывал не ту величину, по которой
   * тест закончится, — самая тихая ложь из возможных.
   */
  const heroLabel = test.testType === "ctr" ? "CTR" : test.testType === "cr" ? "CR" : "Видео";
  const heroOf = (v: CtrVariantView) => (test.testType === "ctr" ? ctrOf(v) : v.score == null ? null : v.score / 100);
  const best = test.variants.map(heroOf).filter((x): x is number => x != null).sort((a, b) => b - a)[0] ?? null;
  const leader = test.variants.find((v) => { const c = heroOf(v); return c != null && c >= (best ?? 0); }) ?? null;

  const counts = (v: CtrVariantView) => ({ impressions: total(v, "impressions"), clicks: total(v, "clicks") });
  /**
   * Разрыв считается ПОПАРНО: лидер против этого варианта, на их общей слабой
   * выборке. Общий порог из вердикта посчитан по лидеру и второму месту — для
   * третьего варианта, у которого показов вдесятеро меньше, он был бы просто
   * неверен, и красный чип «доказанно хуже» оказался бы ложью.
   */
  const gapOf = (v: CtrVariantView) => (leader && leader.id !== v.id ? ctrGapVerdict(counts(leader), counts(v)) : null);

  // Тон: красный только когда разрыв больше различимого на этой паре — то
  // есть когда в нём можно быть уверенным. Иначе янтарный. У самого лидера
  // сплошной изумруд включается лишь после того, как вердикт признал разницу
  // надёжной; до этого — бледный «впереди».
  const gapTone = (v: CtrVariantView): Tone => {
    // Порог различимости считается только для кликов. У cr и video такого
    // расчёта нет, поэтому там нет и права красить кого-то «доказанно хуже»:
    // отставание показывается числом, но не цветом приговора.
    if (leader && leader.id === v.id) return test.testType === "ctr" && verdict?.decisive ? "lead" : "ahead";
    if (test.testType !== "ctr") return "neutral";
    const gap = gapOf(v);
    if (!gap) return "neutral";
    return gap.decisive ? "bad" : "warn";
  };

  const num = (key: "impressions" | "clicks" | "opens" | "carts" | "orders") => ({
    cell: (v: CtrVariantView): Cell => ({ text: number(total(v, key)) }),
    value: (v: CtrVariantView) => total(v, key),
  });
  const rows: Row[] = [
    { group: "Охват", label: "Показов", ...num("impressions") },
    { group: "Охват", label: "Кликов", ...num("clicks") },
    // Отклонение от ЛУЧШЕГО, а не только от базы. База — это то, с чего
    // начали; лучший — то, ради чего тест. Когда вариантов больше двух,
    // «на сколько я отстаю от вожака» отвечает на вопрос «кого выключать»,
    // а «изменение к базе» — нет.
    {
      group: "Отклик",
      label: "Отставание от лучшего",
      cell: (v) => {
        const mine = heroOf(v);
        if (mine == null || best == null) return { text: "—", tone: "muted" };
        if (leader && leader.id === v.id) return test.testType === "ctr" && verdict?.decisive ? { text: "лучший", tone: "lead" } : { text: "впереди", tone: "ahead" };
        return { text: `${((best - mine) * 100).toFixed(2)} п.п.`, tone: gapTone(v), arrow: "down" };
      },
    },
    {
      group: "Отклик",
      label: "Изменение к базе",
      cell: (v) => {
        if (v.isBaseline) return { text: "база", tone: "muted" };
        if (v.resultPct == null) return { text: "—", tone: "muted" };
        if (Math.abs(v.resultPct) < 0.005) return { text: "0%", tone: "neutral" };
        return v.resultPct > 0
          ? { text: `+${v.resultPct.toFixed(2)}%`, tone: "good", arrow: "up" }
          : { text: `${v.resultPct.toFixed(2)}%`, tone: "bad", arrow: "down" };
      },
    },
    { group: "Воронка", label: "Открытий", ...num("opens") },
    { group: "Воронка", label: "Корзин", ...num("carts") },
    { group: "Воронка", label: "Заказов", ...num("orders") },
    { group: "Раунды и расход", label: "Побед в раундах", cell: (v) => (v.roundsWon > 0 ? { text: `${v.roundsWon} раз`, tone: "good" } : { text: "0 раз", tone: "muted" }) },
    { group: "Раунды и расход", label: "Раундов", cell: (v) => ({ text: number(v.roundsCount) }), value: (v) => v.roundsCount },
    { group: "Раунды и расход", label: "Расход", cell: (v) => ({ text: `${number(total(v, "spend"))} ₽` }), value: (v) => total(v, "spend") },
  ];
  // Главная доля стоит крупно в шапке столбца, и повторять её строкой значит
  // удлинять таблицу ради того же числа. А вот вторая доля — нужна: у
  // ctr-теста в шапке CTR, значит в таблице ничего лишнего; у cr и video в
  // шапке своя метрика, и CTR становится справочной строкой.
  if (test.testType !== "ctr") {
    rows.splice(2, 0, {
      group: "Отклик",
      label: "CTR",
      cell: (v) => { const c = ctrOf(v); return c == null ? { text: "—", tone: "muted" } : { text: `${(c * 100).toFixed(2)}%` }; },
      value: (v) => ctrOf(v) ?? 0,
    });
  }
  return { rows, best, heroOf, heroLabel, gapTone, leader, total };
}

/** Вся группа по нулям: показывать её тремя пустыми рядами — тратить взгляд. */
function isEmptyGroup(items: Row[], variants: CtrVariantView[]) {
  return items.length > 1 && items.every((row) => row.value != null && variants.every((variant) => row.value!(variant) === 0));
}

/** Полоска величины: доля от лучшего в строке, цветом столбца. */
function Bar({ share, role, thick = false }: { share: number; role: Role; thick?: boolean }) {
  return (
    <span className={`block w-full overflow-hidden rounded-full bg-slate-200/70 ${thick ? "h-1.5" : "h-1"}`}>
      <span className={`block h-full rounded-full ${ROLE_BAR[role]}`} style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
    </span>
  );
}

/** Рендер одной клетки: чип для суждений, число с полосой для величин. */
function CellView({ cell, share, role }: { cell: Cell; share: number | null; role: Role }) {
  const tone = cell.tone ?? "neutral";
  const arrow = cell.arrow === "up" ? "↑" : cell.arrow === "down" ? "↓" : "";
  const isChip = tone === "lead" || tone === "ahead" || tone === "good" || tone === "warn" || tone === "bad";
  return (
    <div className="mx-auto flex max-w-[150px] flex-col items-center gap-1">
      {isChip ? (
        <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${TONE_CHIP[tone]}`}>{cell.text}{arrow ? <span aria-hidden="true">{arrow}</span> : null}</span>
      ) : (
        <span className={`text-[11px] font-medium tabular-nums ${TONE_TEXT[tone]}`}>{cell.text}</span>
      )}
      {share == null ? null : <Bar share={share} role={role} />}
    </div>
  );
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
        className="mx-auto grid h-36 w-[108px] md:h-56 md:w-[168px] place-items-center rounded-md bg-slate-100 px-1 text-center text-[9px] font-semibold leading-3 text-slate-500"
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
  return <img src={url} alt="" onError={() => setBroken(true)} className="mx-auto h-36 w-auto rounded-md bg-slate-50 object-contain md:h-56" />;
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

  const { rows, best, heroOf, heroLabel, gapTone, leader } = metricRows(test, verdict);
  /**
   * Кого метить лидером.
   *
   * Когда победитель уже зафиксирован, отметка лидера по CTR снимается: если
   * владелец выбрал не того, кто впереди по кликам, изумрудная корона на
   * чужой карточке спорила бы с принятым решением, а если того — просто
   * дублировала бы его.
   */
  const leadId = winner ? null : leader?.id ?? null;
  // Роль ведёт цвет столбца сверху донизу, и взгляд не сползает на соседний
  // вариант. Приоритет у вожака: «сейчас» и без того подписано ярлыком и
  // кольцом, а вот кто впереди — по одному ярлыку не понять.
  const roleOf = (variant: CtrVariantView): Role =>
    variant.id === leadId ? (test.testType === "ctr" && verdict?.decisive ? "lead" : "ahead") : variant.id === test.currentVariantId ? "current" : "plain";
  // Двенадцать одинаковых строк читаются как простыня; четыре подписанные
  // группы дают ритм и говорят, что где искать.
  const groups = rows.reduce<{ title: string; items: Row[] }[]>((acc, row) => {
    const last = acc[acc.length - 1];
    if (last && last.title === row.group) last.items.push(row);
    else acc.push({ title: row.group, items: [row] });
    return acc;
  }, []);

  const scaleMax = verdict ? Math.max(verdict.gapShare, verdict.detectableShare) * 1.25 || 1 : 1;
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
          <div className={`mb-2 rounded-xl border px-3 py-2.5 ${verdict.decisive ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
            <div className="flex items-start gap-2.5">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${verdict.decisive ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                {verdict.decisive ? <Trophy className="h-3.5 w-3.5" /> : <Hourglass className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0">
                {/* Ответ на главный вопрос экрана — двумя словами и крупно.
                    Прежде он был одиннадцатым кеглем в середине абзаца: чтобы
                    узнать «решать или ждать», приходилось вычитывать фразу. */}
                <p className={`text-sm font-bold leading-5 ${verdict.decisive ? "text-emerald-900" : "text-slate-900"}`}>
                  {verdict.decisive ? "Можно решать" : "Решать рано"}
                  {/* Порог различимости считается по кликам. На cr- и
                      video-тестах решают другой долей, и заголовок обязан
                      сказать, о чём именно он говорит. */}
                  {test.testType === "ctr" ? null : <span className="ml-1 text-[11px] font-medium text-slate-400">— по кликам</span>}
                </p>
                <p className={`mt-0.5 text-[11px] leading-5 ${verdict.decisive ? "text-emerald-800" : "text-slate-500"}`}>{verdict.text}</p>
              </div>
            </div>
            {/* Шкала «разрыв против порога»: заливка — насколько варианты
                разошлись, засечка — с какой разницы этой выборке вообще можно
                верить. Пока заливка не дошла до засечки, лидерство — совпадение,
                и это видно раньше, чем прочитано. */}
            <div className="mt-2.5 pl-[34px]">
              <div className="relative h-2 rounded-full bg-slate-100">
                <div className={`h-2 rounded-full ${verdict.decisive ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, Math.max(1, verdict.gapShare / scaleMax * 100))}%` }} />
                <span className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-slate-400" style={{ left: `${Math.min(100, verdict.detectableShare / scaleMax * 100)}%` }} aria-hidden="true" />
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                <span><b className={`font-semibold ${verdict.decisive ? "text-emerald-700" : "text-amber-700"}`}>разрыв {Math.round(verdict.gapShare * 100)}%</b></span>
                <span>порог различимости {Math.round(verdict.detectableShare * 100)}%</span>
                {verdict.decisive ? null : (
                  <span>
                    {verdict.needSample == null
                      ? "при нынешнем равенстве вариантов надёжного ответа не даст никакая выборка"
                      : `набрано ${Math.round(verdict.progress * 100)}% нужной выборки — до ответа около ${verdict.needSample.toLocaleString("ru-RU")} показов на варианте, если разрыв сохранится`}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : null}
        <div className="scroll-x rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-[116px] min-w-[116px] border-b border-r border-slate-200 bg-white align-bottom md:w-[180px] md:min-w-[180px]">
                  {/* Пустой угол таблицы отдан ключу к цветам. Цвет здесь несёт
                      суждение, а суждение обязано быть читаемым и без цвета —
                      иначе экран говорит только тем, кто различает оттенки.
                      На телефоне ключ скрыт: там этот угол шириной в палец. */}
                  <ul className="hidden space-y-1 p-3 text-left text-[9px] leading-3 text-slate-400 md:block">
                    {[
                      ["bg-emerald-500", "впереди по отклику"],
                      ["bg-amber-400", "позади, но внутри погрешности"],
                      ["bg-rose-500", "отставание уже доказано"],
                      ["bg-violet-500", "меряется прямо сейчас"],
                    ].map(([dot, label]) => (
                      <li key={label} className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                </th>
                {test.variants.map((variant) => {
                  const role = roleOf(variant);
                  const isCurrent = variant.id === test.currentVariantId;
                  const hero = heroOf(variant);
                  return (
                    <th key={variant.id} className={`min-w-[190px] border-b border-slate-200 p-2 align-top ${ROLE_COLUMN[role]}`}>
                      {/* Карточка варианта — трёх состояний: «сейчас» (фиолетовое
                          кольцо, идёт замер), «победитель» (изумрудная заливка,
                          решено) и «лидер» (изумрудное кольцо — впереди, но ещё
                          не выбран). Ярлыки лежат в одной строке, потому что
                          вариант бывает одновременно и текущим, и лидером. */}
                      <div className={`relative mx-auto max-w-[240px] rounded-xl border p-2 shadow-sm ${variant.isWinner ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : ROLE_CARD[role]}`}>
                        <div className="absolute -top-2 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap">
                          {isCurrent ? <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[8px] font-semibold text-white shadow-sm">сейчас</span> : null}
                          {variant.isWinner
                            ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[8px] font-semibold text-white shadow-sm">победитель</span>
                            : variant.id === leadId
                              ? <span className={`rounded-full px-2 py-0.5 text-[8px] font-semibold shadow-sm ${test.testType === "ctr" && verdict?.decisive ? "bg-emerald-600 text-white" : "border border-emerald-300 bg-white text-emerald-700"}`}>{test.testType === "ctr" && verdict?.decisive ? "лидер" : "впереди"}</span>
                              : null}
                        </div>
                        {test.testType === "video"
                          ? <video src={variant.imageUrl} controls muted preload="metadata" className="mx-auto h-36 w-auto rounded-md bg-slate-50 object-contain md:h-56" />
                          : <VariantImage url={variant.imageUrl} label={variant.label} />}
                        <div className="mt-1.5 flex items-center justify-center gap-1">
                          <span className="truncate text-[11px] font-semibold text-slate-700">{variant.label}</span>
                          {variant.imageUrl ? <a href={variant.imageUrl} download target="_blank" rel="noreferrer" aria-label={`Скачать «${variant.label}»`} className="tap-hit shrink-0 text-slate-400 transition-colors hover:text-violet-600"><Download className="h-3 w-3" /></a> : null}
                        </div>
                        {variant.isBaseline ? <div className="text-center text-[8px] font-semibold uppercase tracking-wide text-violet-400">база</div> : null}
                        {/* CTR стоит вплотную к обложке и крупно: человек
                            сравнивает картинки, а не строки, и число должно
                            попадать в тот же взгляд, что и кадр. Полоса под ним
                            — доля от лучшего: отставание видно до чтения. */}
                        <div className="mt-2 rounded-lg bg-slate-50/80 px-2 py-2">
                          <div className="text-center text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400">{heroLabel}</div>
                          <div className={`text-center text-2xl font-bold leading-7 tabular-nums ${hero == null ? "text-slate-300" : TONE_TEXT[gapTone(variant)]}`}>{hero == null ? "—" : `${(hero * 100).toFixed(2)}%`}</div>
                          <div className="mt-1.5"><Bar share={hero != null && best ? hero / best : 0} role={role} thick /></div>
                        </div>
                        {test.status === "paused" && !variant.isWinner ? <button type="button" onClick={() => trigger("winner", variant)} disabled={busy} className="mt-2 min-h-11 w-full rounded-md border border-emerald-200 px-2 text-[9px] font-semibold text-emerald-700 disabled:opacity-50">Выбрать победителем</button> : null}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.title}>
                <tr>
                  <th colSpan={1 + test.variants.length} scope="colgroup" className="border-t border-slate-200 bg-slate-50/80 px-3 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">{group.title}</th>
                </tr>
                {/* Группа, в которой у всех вариантов по нулям, сворачивается в
                    одну строку. Ноль остаётся нулём — данные есть, и они такие,
                    — но три пустых ряда не должны весить столько же, сколько
                    собранные показы, и оттягивать взгляд от того, что меряется. */}
                {isEmptyGroup(group.items, test.variants) ? (
                  <tr>
                    <th scope="row" className="sticky left-0 z-10 border-r border-t border-slate-100 bg-white px-2 py-2 text-left text-[10px] font-medium leading-4 text-slate-500 md:px-3 md:text-[11px]">{group.items.map((row) => row.label.toLowerCase()).join(", ")}</th>
                    <td colSpan={test.variants.length} className="border-t border-slate-100 px-3 py-2 text-center text-[10px] text-slate-400">по нулям у всех вариантов — на таких объёмах воронка вариантов не различает</td>
                  </tr>
                ) : group.items.map((row) => {
                  const values = row.value ? test.variants.map((variant) => row.value!(variant)) : [];
                  const max = values.length ? Math.max(...values) : 0;
                  // Полосы нужны для сравнения. Когда у всех одно и то же —
                  // сравнивать нечего, и ряд одинаковых полных полос только
                  // шумит.
                  const comparable = values.length > 0 && max > 0 && Math.min(...values) !== max;
                  // Строка, где у всех ноль, гаснет целиком: пустая воронка не
                  // должна весить столько же, сколько собранные показы.
                  const dim = Boolean(row.value) && max === 0;
                  return (
                    <tr key={row.label}>
                      <th scope="row" className="sticky left-0 z-10 border-r border-t border-slate-100 bg-white px-2 py-2 text-left text-[10px] font-medium leading-4 text-slate-500 md:px-3 md:text-[11px]">{row.label}</th>
                      {test.variants.map((variant) => {
                        const role = roleOf(variant);
                        const cell = row.cell(variant);
                        return (
                          <td key={variant.id} className={`border-t border-slate-100 px-3 py-2 ${ROLE_COLUMN[role]}`}>
                            <CellView
                              cell={dim ? { ...cell, tone: "muted" } : cell}
                              share={comparable && row.value ? row.value(variant) / max : null}
                              role={role}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
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
