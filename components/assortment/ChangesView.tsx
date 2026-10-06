"use client";

import Link from "next/link";
import { Check, ExternalLink, EyeOff, ImageOff, LoaderCircle, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { APPEARANCE_MIN_SPAN_DAYS } from "@/lib/assortment/observationState";
import { CHANGES_PERIODS, DEFAULT_CHANGES_PERIOD, DISAPPEAR_FULL_RUNS, DISAPPEAR_RULE_TEXT, dm, type ChangesPeriod } from "@/lib/assortment/appearance";
import type { ChangeCard, ChangesResult, ChangesSourceView } from "@/lib/assortment/appearanceStore";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { isReferenceStatus, STATUS_LABEL } from "@/lib/assortment/decisions";
import { sampleLinks } from "@/lib/assortment/whereToBuy";
import { plural } from "@/lib/warehouse/plural";

/**
 * «Изменения»: что бренды добавили и что убрали за неделю (или месяц) — по снимкам полных прогонов обхода. Источники, которые видят
 * только верх выдачи, и части разделов — отдельным списком «впервые в верху выдачи» («пропало» у них не бывает). Карточка: фото,
 * бренд, название, источник, даты прогонов; «Отобрать» и «Не интересно» — те же действия, что в «Каталогах брендов»; «где купить
 * образец». Телефон и iPad в портрете (до 1023 px) — одна колонка (ТЗ Ф3), пояснения видимым текстом, цели нажатия ≥ 44 px. Цен нет.
 */

type Ready = Extract<ChangesResult, { available: true }>;
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; result: Ready };

/** Что человек уже сделал с карточкой на этом экране (до перезагрузки). */
export interface ChangeLocal {
  busy?: boolean;
  error?: string | null;
  picked?: { href: string; label: string } | null;
  hidden?: boolean;
}

/** Сколько карточек группы видно сразу; дальше — «Показать ещё». */
export const CHANGES_PAGE = 24;

const chip = (active: boolean) => `h-11 shrink-0 rounded-full px-4 text-sm ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
const linkButton = "inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 hover:bg-slate-50";
const kindTag = "text-xs text-slate-400";
const PERIOD_LABEL: Record<ChangesPeriod, string> = { 7: "Неделя", 30: "Месяц" };

/** «29.09», «29.09 и 30.09», «28.09, 29.09 и 30.09» — по возрастанию. */
export function datesText(days: readonly string[]): string {
  const list = [...days].sort().map(dm);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} и ${list[list.length - 1]}`;
}

async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : `Не получилось (${response.status})`);
  return json;
}

export function ChangesView({ direction }: { direction: AssortmentDirection }) {
  const [days, setDays] = useState<ChangesPeriod>(DEFAULT_CHANGES_PERIOD);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [local, setLocal] = useState<Record<string, ChangeLocal>>({});
  const busyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/assortment-development/changes?direction=${direction}&days=${days}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<ChangesResult> & { error?: string; reason?: string };
        if (cancelled) return;
        if (!response.ok) return setState({ kind: "error", message: body.error || `Изменения не загрузились (${response.status})` });
        if (body.available === false) return setState({ kind: "unavailable", reason: String(body.reason ?? "Журнала прогонов ещё нет.") });
        setState({ kind: "ready", result: body as Ready });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction, days]);

  /** Одно действие на карточку за раз: второе нажатие, пока идёт первое, не уходит. */
  const run = useCallback(async (key: string, action: () => Promise<Partial<ChangeLocal>>) => {
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setLocal((cur) => ({ ...cur, [key]: { ...cur[key], busy: true, error: null } }));
    try {
      const result = await action();
      setLocal((cur) => ({ ...cur, [key]: { ...cur[key], ...result, busy: false } }));
    } catch (e) {
      setLocal((cur) => ({ ...cur, [key]: { ...cur[key], busy: false, error: e instanceof Error ? e.message : "Не получилось" } }));
    } finally {
      busyRef.current.delete(key);
    }
  }, []);

  const actions: CardActions = {
    onPick: (card) => run(card.key, async () => {
      const body = await send("/api/assortment-development/catalog/pick", "POST", { sourceId: card.sourceId, itemId: card.itemId });
      return { picked: { href: String(body.href ?? ""), label: typeof body.statusLabel === "string" ? body.statusLabel : "Находка" } };
    }),
    onHide: (card) => run(card.key, async () => {
      await send("/api/assortment-development/catalog/hide", "PATCH", { sourceId: card.sourceId, itemId: card.itemId, hidden: true });
      return { hidden: true };
    }),
    onRestore: (card) => run(card.key, async () => {
      await send("/api/assortment-development/catalog/hide", "PATCH", { sourceId: card.sourceId, itemId: card.itemId, hidden: false });
      return { hidden: false };
    }),
  };

  return (
    <div className="flex flex-col gap-4">
      <ChangesIntro />
      {state.kind === "unavailable" && <ChangesUnavailable reason={state.reason} />}
      {state.kind !== "unavailable" && (
        <>
          <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:px-0" aria-label="Период">
            {CHANGES_PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)} className={chip(days === p)}>{PERIOD_LABEL[p]}</button>
            ))}
          </div>
          {state.kind === "loading" && <div className="text-sm text-slate-500">Сравниваем прогоны…</div>}
          {state.kind === "error" && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
          {state.kind === "ready" && <ChangesBody result={state.result} local={local} actions={actions} />}
        </>
      )}
    </div>
  );
}

export interface CardActions {
  onPick: (card: ChangeCard) => void;
  onHide: (card: ChangeCard) => void;
  onRestore: (card: ChangeCard) => void;
}

/** Подпись вкладки: что это и чем не является. */
export function ChangesIntro() {
  return (
    <p className="text-sm leading-6 text-slate-600">
      Что бренды добавили и что убрали — по снимкам полных обходов их сайтов (весь раздел, а не верх выдачи). Это наблюдение, а не причина:
      «пропало» не говорит, распродано, раскуплено или снято. Продаж и цен здесь нет.
    </p>
  );
}

/** Журнала прогонов нет (миграция не применена) — одна строка причины; вкладка в этом случае открывается только по адресу. */
export function ChangesUnavailable({ reason }: { reason: string }) {
  return <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{reason}</div>;
}

/** Готовый ответ: подпись сезона, группы, пустые состояния и список источников. Чистая разметка — проверяется статическим рендером. */
export function ChangesBody({ result, local = {}, actions }: { result: Ready; local?: Record<string, ChangeLocal>; actions?: CardActions }) {
  const ready = result.sources.filter((s) => s.status === "ready");
  const fullReady = ready.filter((s) => s.kind === "full");
  const disappearReady = fullReady.filter((s) => s.disappearReady);
  const disappearPending = fullReady.filter((s) => !s.disappearReady);
  const windowReady = ready.filter((s) => s.kind !== "full");
  const period = result.periodDays === 30 ? "за месяц" : "за неделю";
  const nothing = result.totals.appeared + result.totals.disappeared + result.totals.firstInWindow === 0;
  const stale = ready.filter((s) => s.baseStale && s.baseOn[0]);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-slate-600">
        Сравниваем прогоны после {dm(result.periodStart)} с прогонами на {dm(result.periodStart)} и раньше; сегодня {dm(result.today)}.
      </p>
      {stale.length > 0 && <StaleBaseNote sources={stale} period={period} />}
      {result.season && <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{result.season}</p>}
      {ready.length === 0 ? (
        <ChangesEmpty sources={result.sources} />
      ) : (
        <>
          {nothing && (
            <section className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center">
              <div className="text-base font-semibold text-slate-900">{`${period[0].toUpperCase()}${period.slice(1)} у брендов ничего не появилось и не пропало`}</div>
              <p className="max-w-xl text-sm leading-6 text-slate-600">Сравнили {ready.length} {plural(ready.length, "источник", "источника", "источников")}: {ready.map(sourceName).join(", ")}.</p>
            </section>
          )}
          {fullReady.length > 0 && (
            <ChangesGroup
              title="Появилось"
              total={result.totals.appeared}
              hint={`В последнем полном прогоне модель есть, а в ${DISAPPEAR_FULL_RUNS} полных прогонах на начало периода её не было и раньше обход её не видел: вернувшаяся в наличие — не «появилось». Источник — с историей от ${APPEARANCE_MIN_SPAN_DAYS} дней.`}
              empty={`${period[0].toUpperCase()}${period.slice(1)} новых моделей нет.`}
              cards={result.groups.appeared}
              local={local}
              actions={actions}
            />
          )}
          {disappearReady.length > 0 && (
            <ChangesGroup
              title="Пропало"
              total={result.totals.disappeared}
              hint={`${DISAPPEAR_RULE_TEXT} Оборванные обходы не засчитываются.`}
              empty={`${period[0].toUpperCase()}${period.slice(1)} ничего не пропало.`}
              cards={result.groups.disappeared}
              local={local}
              actions={actions}
            />
          )}
          {disappearPending.length > 0 && <DisappearPending sources={disappearPending} />}
          {windowReady.length > 0 && (
            <ChangesGroup
              title="Впервые в верху выдачи"
              total={result.totals.firstInWindow}
              hint={`${windowReady.map(sourceName).join(", ")} — видим только верх выдачи или часть раздела: модель сейчас там, а в ${DISAPPEAR_FULL_RUNS} прогонах на начало периода её не было и раньше обход её не видел. «Пропало» здесь не бывает: выпасть из верха выдачи — не исчезнуть с сайта.`}
              empty="Новых моделей в верху выдачи нет."
              cards={result.groups.firstInWindow}
              local={local}
              actions={actions}
            />
          )}
          {result.totals.hidden > 0 && (
            <p className="text-xs leading-5 text-slate-500">Без {result.totals.hidden} {plural(result.totals.hidden, "модели", "моделей", "моделей")}, скрытых кнопкой «Не интересно».</p>
          )}
        </>
      )}
      <ChangesSources sources={result.sources} />
      <ChangesRule />
    </div>
  );
}

const sourceName = (s: Pick<ChangesSourceView, "name" | "part">) => (s.part ? `${s.name} (${s.part})` : s.name);

const daysWord = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

/** База на начало периода устарела (сборщик простаивал): изменения таких источников накоплены за весь простой — сказано прямо. */
export function StaleBaseNote({ sources, period }: { sources: ChangesSourceView[]; period: string }) {
  return (
    <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      Не {period}: {sources.map((s) => `${sourceName(s)} — с ${dm(s.baseOn[0])}${s.spanDays != null ? `, за ${daysWord(s.spanDays)}` : ""}`).join("; ")}.
      {" "}Между прогонами сборщик простаивал, и всё, что изменилось за простой, попало в эти списки — даты прогонов в карточках.
    </p>
  );
}

/** Ни один источник ещё не готов: что копится и с какого дня станет честным (расчёт по текущим порогам). */
export function ChangesEmpty({ sources }: { sources: ChangesSourceView[] }) {
  const building = sources.filter((s) => s.status === "building");
  return (
    <section className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <div className="text-base font-semibold text-slate-900">Сравнивать пока не по чему</div>
      <p className="max-w-xl text-sm leading-6 text-slate-600">
        Нужны полные прогоны с разрывом от {APPEARANCE_MIN_SPAN_DAYS} дней и хотя бы один полный прогон за период.
        {building.length > 0 && ` Копится: ${building.map((s) => `${sourceName(s)} — ${s.readyOn ? `не раньше ${dm(s.readyOn)}` : "ждёт первого прогона"}`).join("; ")} (расчёт).`}
      </p>
    </section>
  );
}

/** «Пропало» ещё не считаем: полных прогонов меньше DISAPPEAR_FULL_RUNS + 1 — сказано словами, а не пустым списком. */
export function DisappearPending({ sources }: { sources: ChangesSourceView[] }) {
  return (
    <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
      «Пропало» пока не считаем: {sources.map((s) => `${sourceName(s)} — после ещё ${s.disappearRunsMissing} ${plural(s.disappearRunsMissing, "полного прогона", "полных прогонов", "полных прогонов")}`).join("; ")}.
      {" "}Нужно {DISAPPEAR_FULL_RUNS} полных прогона подряд без модели, иначе случайный пропуск выглядел бы как «пропало».
    </p>
  );
}

export function ChangesGroup({ title, total, hint, empty, cards, local, actions }: {
  title: string;
  total: number;
  hint: string;
  empty: string;
  cards: ChangeCard[];
  local: Record<string, ChangeLocal>;
  actions?: CardActions;
}) {
  const [shown, setShown] = useState(CHANGES_PAGE);
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-base font-semibold text-slate-900">
        {title} · {total.toLocaleString("ru-RU")} <span className="text-xs font-normal text-slate-400">— расчёт по снимкам обхода</span>
      </h2>
      <p className="text-sm leading-6 text-slate-600">{hint}</p>
      {cards.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {cards.slice(0, shown).map((card) => (
              <ChangeCardView key={card.key} card={card} local={local[card.key] ?? {}} actions={actions} />
            ))}
          </ul>
          {(shown < cards.length || total > cards.length) && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span>Показано {Math.min(shown, cards.length)} из {total.toLocaleString("ru-RU")}</span>
              {shown < cards.length && (
                <button type="button" onClick={() => setShown((n) => n + CHANGES_PAGE)} className={linkButton}>Показать ещё</button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const WORK = new Set(["selected", "sample_needed", "in_collection"]);
/** «Отобрать» — у модели, которой ещё нет среди находок, и у новой или отложенной находки (как в «Каталогах брендов»). */
const canPick = (card: ChangeCard) => !card.referenceId || card.referenceStatus === "new" || card.referenceStatus === "watching";

/** Строка про прогоны: в каком модель есть и в каких её нет. */
export function runsLine(card: Pick<ChangeCard, "kind" | "seenOn" | "absentOn">): string {
  const absent = `${card.absentOn.length === 1 ? "прогоне" : "прогонах"} ${datesText(card.absentOn)}`;
  if (card.kind === "appeared") return `Есть в полном прогоне ${dm(card.seenOn)}; не было в ${absent}`;
  // Прогоны между базой и последними не читаются: дата базы — «была на начало периода», а не «последний раз».
  if (card.kind === "disappeared") return `Была в полном прогоне ${dm(card.seenOn)} (на начало периода); нет в ${card.absentOn.length} ${plural(card.absentOn.length, "полном прогоне", "полных прогонах подряд", "полных прогонах подряд")}: ${datesText(card.absentOn)}`;
  return `В верху выдачи ${dm(card.seenOn)}; не было в ${absent}`;
}

/** Карточка модели: фото, бренд, название, источник, даты прогонов, действия и «где купить образец». */
export function ChangeCardView({ card, local, actions }: { card: ChangeCard; local: ChangeLocal; actions?: CardActions }) {
  const busy = Boolean(local.busy);
  if (local.hidden) {
    return (
      <li className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center">
        <span className="break-anywhere line-clamp-2 text-xs text-slate-500">{card.title}</span>
        <span className="text-sm text-slate-700">Скрыто: модель ушла из каталога и из «Изменений»</span>
        <button type="button" onClick={() => actions?.onRestore(card)} disabled={busy} className={`${linkButton} disabled:opacity-60`}>
          <Undo2 className="h-4 w-4" /> Вернуть
        </button>
        {local.error && <span role="alert" className="text-xs text-red-700">{local.error}</span>}
      </li>
    );
  }
  const samples = sampleLinks({ brand: card.brand, title: card.title, article: null, url: card.productUrl });
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex gap-3">
        <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-xl bg-[#f4f2ee] sm:w-28">
          <ChangePhoto card={card} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-xs font-medium text-slate-600">{card.brand}{card.brand !== card.sourceName ? <span className="font-normal text-slate-500"> · {card.sourceName}</span> : null}</div>
          <div className="break-anywhere line-clamp-3 text-sm font-medium leading-5 text-slate-900">{card.title}</div>
          {card.part && <div className="text-xs text-slate-500">Часть раздела: {card.part}</div>}
          <div className="text-xs leading-5 text-slate-600">
            {runsLine(card)} <span className={kindTag}>— факт обхода</span>
          </div>
          {card.staleSpanDays != null && <div className="text-xs leading-5 text-amber-800">Сравнение за {daysWord(card.staleSpanDays)}, а не за период: между прогонами сборщик простаивал.</div>}
          {card.mass && <div className="text-xs leading-5 text-amber-800">У источника массовая смена — похоже на смену обхода, а не на решение бренда (оценка).</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {local.picked?.href ? (
          <Link href={local.picked.href} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-50 px-3 text-sm font-medium text-violet-800 hover:bg-violet-100">
            <Check className="h-4 w-4" /> {local.picked.label} · открыть
          </Link>
        ) : card.findingHref ? (
          <Link href={card.findingHref} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-50 px-3 text-sm font-medium text-violet-800 hover:bg-violet-100">
            {isWork(card.referenceStatus) && <Check className="h-4 w-4" />}
            {isReferenceStatus(card.referenceStatus) ? STATUS_LABEL[card.referenceStatus] : "Находка"} · открыть
          </Link>
        ) : null}
        {card.inCatalog && !local.picked && canPick(card) && (
          <button type="button" onClick={() => actions?.onPick(card)} disabled={busy} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-700 px-3 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Отобрать
          </button>
        )}
        {card.inCatalog && !card.referenceId && !local.picked && (
          <button type="button" onClick={() => actions?.onHide(card)} disabled={busy} className={`${linkButton} disabled:opacity-60`}>
            <EyeOff className="h-4 w-4" /> Не интересно
          </button>
        )}
        {card.productUrl && (
          <a href={card.productUrl} target="_blank" rel="noopener noreferrer" className={linkButton}>
            <ExternalLink className="h-4 w-4" /> На сайте
          </a>
        )}
      </div>
      {samples.length > 0 && (
        <details className="rounded-xl bg-slate-50 px-3 text-sm">
          <summary className="flex h-11 cursor-pointer items-center font-medium text-slate-800">Где купить образец</summary>
          <ul className="flex flex-col pb-2">
            {samples.map((s) => (
              <li key={s.label}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 flex-col justify-center py-1 text-violet-700 hover:text-violet-900">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-xs text-slate-500">{s.note}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {local.error && <div role="alert" className="text-xs leading-5 text-red-700">{local.error}</div>}
    </li>
  );
}

const isWork = (status: string | null | undefined) => Boolean(status && WORK.has(status));

function ChangePhoto({ card }: { card: ChangeCard }) {
  const [stage, setStage] = useState<"direct" | "proxy" | "failed">("direct");
  if (!card.image || stage === "failed") {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-slate-500">
        <ImageOff className="h-6 w-6" />
        <span className="text-xs">{card.image ? "фото не открылось" : "фото нет"}</span>
      </span>
    );
  }
  // Фото — с сайта бренда; не открылось — у модели каталога один раз через панель (прокси без сохранения).
  const src = stage === "direct" ? card.image : `/api/assortment-development/catalog/photo?source=${encodeURIComponent(card.sourceId)}&item=${encodeURIComponent(card.itemId)}&n=0`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={card.title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "direct" && card.inCatalog ? "proxy" : "failed"))}
      className="h-full w-full object-contain"
    />
  );
}

const STATUS_TEXT = (s: ChangesSourceView): string => {
  const runs = s.latestOn ? `прогоны ${s.baseOn[0] ? `${dm(s.baseOn[0])} → ` : ""}${dm(s.latestOn)}${s.baseStale && s.spanDays != null ? ` (за ${daysWord(s.spanDays)}: сборщик простаивал)` : ""}` : "";
  if (s.status === "ready") {
    if (s.kind !== "full") return `${runs}: впервые в верху выдачи — ${s.firstInWindow}`;
    const disappeared = s.disappearReady
      ? `, пропало — ${s.disappeared}`
      : ` («пропало» — после ещё ${s.disappearRunsMissing} ${plural(s.disappearRunsMissing, "полного прогона", "полных прогонов", "полных прогонов")})`;
    return `${runs}: появилось — ${s.appeared}${disappeared}`;
  }
  if (s.status === "building") return `копится — ${s.readyOn ? `не раньше ${dm(s.readyOn)} (расчёт)` : "ждёт первого прогона"}`;
  if (s.status === "gap") return "в одном из прогонов нет ни одной модели раздела — сравнение было бы ложным, источник пропущен";
  return `за период не было ${s.kind === "full" ? "полного " : ""}прогона${s.latestOn ? ` (последний — ${dm(s.latestOn)})` : ""}`;
};

/** Источники: с какими датами сравнивали, что копится и с какого дня — свёрнуто, чтобы не занимать экран телефона. */
export function ChangesSources({ sources }: { sources: ChangesSourceView[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700">
      <summary className="flex h-11 cursor-pointer items-center font-medium text-slate-900">Источники и даты прогонов · {sources.length}</summary>
      <ul className="flex flex-col gap-1.5 pb-3 leading-6">
        {sources.map((s) => (
          <li key={`${s.sourceId}|${s.part ?? ""}`}>
            <span className="font-medium text-slate-900">{sourceName(s)}</span>
            {s.kind !== "full" && <span className="text-slate-500"> · {s.kind === "part" ? "часть раздела" : "только верх выдачи"}</span>}
            {" — "}{STATUS_TEXT(s)}
            {s.mass && <span className="text-amber-800"> · массовая смена: похоже на смену обхода, а не на решения бренда (оценка)</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Правило словами — свёрнуто. */
export function ChangesRule() {
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700">
      <summary className="flex h-11 cursor-pointer items-center font-medium text-slate-900">Как считаем «появилось» и «пропало»</summary>
      <ul className="flex list-disc flex-col gap-1 pb-3 pl-5 leading-6">
        <li>Сравниваем только полные прогоны — когда обход прошёл раздел сайта до конца. Оборванный обход не засчитывается ни как «есть», ни как «нет»; в один день — один полный прогон (повтор обхода — не второе наблюдение).</li>
        <li>«Появилось» — в последнем полном прогоне модель есть, а в {DISAPPEAR_FULL_RUNS} полных прогонах на начало периода её не было и раньше обход её не видел (вернулась в наличие — не «появилось»); у источника не меньше {APPEARANCE_MIN_SPAN_DAYS} дней истории.</li>
        <li>{DISAPPEAR_RULE_TEXT}</li>
        <li>Расцветки одной модели — одна модель: новый цвет старой модели не «появилось», пропажа одного цвета не «пропало». Переименованный товар с тем же номером — та же модель.</li>
        <li>База на начало периода старше его начала больше чем на неделю (сборщик простаивал) — изменения накоплены за весь простой; так и подписано.</li>
        <li>Источники, которые видят только верх выдачи, и части разделов — отдельный список «впервые в верху выдачи»; «пропало» у них не бывает. Выборки одного дня складываются: у ASOS на раздел две — общие слова и Mango.</li>
      </ul>
    </details>
  );
}
