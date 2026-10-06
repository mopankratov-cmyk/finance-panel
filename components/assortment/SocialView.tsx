"use client";

import Link from "next/link";
import { Check, ExternalLink, EyeOff, ImageOff, LoaderCircle, Plus, Undo2, UserX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "@/lib/assortment/constants";
import {
  ACCOUNT_KIND_LABEL, ACCOUNT_KINDS, ACCOUNT_ORIGIN_LABEL, BRAND_LABEL, cardTitle, catalogTarget, compactRu, DEFAULT_FEED_PERIOD, FEED_PERIODS, importableBrandUrl, isInstagramUrl,
  KIND_TEXT, matchLabel, sampleLinksFor, SOCIAL_CRON, timesPhrase, VERDICT_LABEL, type FeedPeriod,
} from "@/lib/assortment/socialFeed";
import type { SocialAccountsResult, SocialAccountView, SocialFeedResult, SocialRunStatus } from "@/lib/assortment/socialFeedStore";
import type { SocialReelCard } from "@/lib/assortment/socialReelsStore";
import type { AccountKind } from "@/lib/assortment/socialReels";
import { plural } from "@/lib/warehouse/plural";

/**
 * «Залетает в соцсетях»: рилсы Instagram про Zara и Uniqlo (только женское), где вещь набрала намного больше обычного у автора.
 * Превью — фото модели с сайта бренда или из каталога (картинки Instagram не показываем и не копируем), рилс — только ссылкой.
 * Лайки и просмотры — не продажи: это то, что видно за рубежом. Телефон — одна колонка, кнопки и ссылки ≥ 44 px.
 */

type ReadyFeed = Extract<SocialFeedResult, { available: true }>;
type FeedState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; feed: ReadyFeed };

/** Что человек уже сделал с карточкой на этом экране (до перезагрузки ленты). */
export interface CardLocal {
  busy?: boolean;
  error?: string | null;
  picked?: { href: string; label: string } | null;
  added?: { href: string } | null;
  hidden?: "reel" | "model" | null;
}

const dm = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
const dmt = (iso: string) => `${dm(iso)} ${new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}`;
const chip = (active: boolean) => `h-11 shrink-0 rounded-full px-4 text-sm ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
const linkButton = "inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 hover:bg-slate-50";
const kindTag = "text-xs text-slate-400";
/** Время крона по Москве (UTC+3 круглый год). */
const CRON_MSK = `${String((SOCIAL_CRON.hourUtc + 3) % 24).padStart(2, "0")}:${String(SOCIAL_CRON.minuteUtc).padStart(2, "0")}`;

async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : `Не получилось (${response.status})`);
  return json;
}

export function SocialView({ direction }: { direction: AssortmentDirection }) {
  const [days, setDays] = useState<FeedPeriod>(DEFAULT_FEED_PERIOD);
  const [onlyStrong, setOnlyStrong] = useState(false);
  const [state, setState] = useState<FeedState>({ kind: "loading" });
  const [local, setLocal] = useState<Record<string, CardLocal>>({});
  // Исключили автора в списке аккаунтов — его рилсы уходят из ленты: перечитываем.
  const [reloadKey, setReloadKey] = useState(0);
  const busyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    const params = new URLSearchParams({ direction, days: String(days) });
    if (onlyStrong) params.set("strong", "1");
    fetch(`/api/assortment-development/social?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<SocialFeedResult> & { error?: string };
        if (cancelled) return;
        if (!response.ok) return setState({ kind: "error", message: body.error || `Лента не загрузилась (${response.status})` });
        if (body.available === false) return setState({ kind: "unavailable", reason: String((body as { reason?: string }).reason ?? "Сбор рилсов ещё не подключён.") });
        setState({ kind: "ready", feed: body as ReadyFeed });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction, days, onlyStrong, reloadKey]);

  /** Одно действие на карточку за раз: второе нажатие, пока идёт первое, не уходит. */
  const run = useCallback(async (code: string, action: () => Promise<Partial<CardLocal>>) => {
    if (busyRef.current.has(code)) return;
    busyRef.current.add(code);
    setLocal((cur) => ({ ...cur, [code]: { ...cur[code], busy: true, error: null } }));
    try {
      const result = await action();
      setLocal((cur) => ({ ...cur, [code]: { ...cur[code], ...result, busy: false } }));
    } catch (e) {
      setLocal((cur) => ({ ...cur, [code]: { ...cur[code], busy: false, error: e instanceof Error ? e.message : "Не получилось" } }));
    } finally {
      busyRef.current.delete(code);
    }
  }, []);

  const onPick = (card: SocialReelCard) => run(card.code, async () => {
    const target = catalogTarget(card);
    if (!target) throw new Error("Модель не из каталога");
    const body = await send("/api/assortment-development/catalog/pick", "POST", target);
    return { picked: { href: String(body.href ?? ""), label: typeof body.statusLabel === "string" ? body.statusLabel : "Находка" } };
  });
  /** «Не интересно» для модели каталога: модель уходит из каталога (как в «Каталогах брендов»), рилс — из ленты. */
  const onHideModel = (card: SocialReelCard) => run(card.code, async () => {
    const target = catalogTarget(card);
    if (target) await send("/api/assortment-development/catalog/hide", "PATCH", { ...target, hidden: true });
    await send("/api/assortment-development/social", "PATCH", { code: card.code, hidden: true });
    return { hidden: target ? "model" : "reel" };
  });
  const onHideReel = (card: SocialReelCard) => run(card.code, async () => {
    await send("/api/assortment-development/social", "PATCH", { code: card.code, hidden: true });
    return { hidden: "reel" };
  });
  const onRestore = (card: SocialReelCard) => run(card.code, async () => {
    const target = local[card.code]?.hidden === "model" ? catalogTarget(card) : null;
    if (target) await send("/api/assortment-development/catalog/hide", "PATCH", { ...target, hidden: false });
    await send("/api/assortment-development/social", "PATCH", { code: card.code, hidden: false });
    return { hidden: null };
  });
  /** «Добавить в находки» — существующий импорт по ссылке на карточку бренда (не на рилс: картинки Instagram не копируем). */
  const onAdd = (card: SocialReelCard) => run(card.code, async () => {
    const url = importableBrandUrl(card);
    if (!url) throw new Error("Нет карточки на сайте бренда");
    const body = await send("/api/assortment-development/import", "POST", { direction, url, title: card.match.title });
    if (typeof body.referenceId !== "string") throw new Error("Находка не сохранилась");
    return { added: { href: `${ASSORTMENT_BASE_PATH}/${direction}/${body.referenceId}` } };
  });

  const feed = state.kind === "ready" ? state.feed : null;
  return (
    <div className="flex flex-col gap-4">
      <SocialIntro />
      {state.kind === "unavailable" && <SocialUnavailable reason={state.reason} />}
      {state.kind !== "unavailable" && (
        <>
          {feed && <SocialRunLine run={feed.run} warnings={feed.warnings} />}
          <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:px-0" aria-label="Фильтры ленты">
            <button type="button" aria-pressed={onlyStrong} onClick={() => setOnlyStrong((v) => !v)} className={chip(onlyStrong)}>Только сильные</button>
            {FEED_PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)} className={chip(days === p)}>{p} дней</button>
            ))}
          </div>
          {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем ленту…</div>}
          {state.kind === "error" && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
          {feed && feed.cards.length === 0 && (
            <SocialEmpty days={feed.days} onlyStrong={feed.onlyStrong} measured={feed.measured} onAllVerdicts={() => setOnlyStrong(false)} onWiden={() => setDays(30)} />
          )}
          {feed && feed.cards.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {feed.cards.map((card) => (
                <SocialReelCardView
                  key={card.code}
                  card={card}
                  local={local[card.code] ?? {}}
                  onPick={() => onPick(card)}
                  onHideModel={() => onHideModel(card)}
                  onHideReel={() => onHideReel(card)}
                  onRestore={() => onRestore(card)}
                  onAdd={() => onAdd(card)}
                />
              ))}
            </ul>
          )}
          <SocialRule />
          <SocialAccounts onChanged={() => setReloadKey((k) => k + 1)} />
        </>
      )}
    </div>
  );
}

/** Подпись вкладки: что это и чем не является. */
export function SocialIntro() {
  return (
    <p className="text-sm leading-6 text-slate-600">
      Рилсы Instagram про Zara и Uniqlo (только женское), где вещь набрала намного больше обычного у автора. Лайки и просмотры — не продажи; за рубежом видно, что вещь заметили, — спрос в РФ это не доказывает.
    </p>
  );
}

/** Таблиц нет (миграция не применена) — одна строка причины; вкладка в этом случае открывается только по адресу. */
export function SocialUnavailable({ reason }: { reason: string }) {
  return <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{reason}</div>;
}

/** Строка сбора: когда был последний прогон и чем кончился, когда следующий; что не загрузилось — названо. */
export function SocialRunLine({ run, warnings }: { run: SocialRunStatus | null; warnings: string[] }) {
  const last = run?.lastRunAt
    ? `последний прогон — ${dmt(run.lastRunAt)}${run.lastStatus === "partial" ? " (доделан не весь: упёрся в потолок запросов или время)" : run.lastStatus === "error" ? " — с ошибкой" : ""}`
    : "прогонов ещё не было";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-6 text-slate-600">
        Сбор ежедневно в {CRON_MSK} МСК, поиск новых рилсов — раз в неделю; {last}{run ? `; следующий — ${dmt(run.nextRunAt)}` : ""}.
        {run?.lastNote && run.lastStatus !== "error" ? <span className="text-slate-500"> Пометка прогона: {run.lastNote}.</span> : null}
      </p>
      {run?.lastStatus === "error" && run.lastNote && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Последний прогон с ошибкой: {run.lastNote}</div>
      )}
      {warnings.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Не загрузилось: {warnings.join("; ")}</div>
      )}
    </div>
  );
}

/** За период ничего не залетело: сколько замерено и что попробовать — а не просто пустота. */
export function SocialEmpty({ days, onlyStrong, measured, onAllVerdicts, onWiden }: { days: number; onlyStrong: boolean; measured: number | null; onAllVerdicts: () => void; onWiden: () => void }) {
  return (
    <section className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <div className="text-base font-semibold text-slate-900">{onlyStrong ? `Сильных залётов за ${days} дней нет` : `За ${days} дней ничего не залетело`}</div>
      <p className="max-w-xl text-sm leading-6 text-slate-600">
        {measured != null ? `Замерено рилсов раздела за период: ${measured.toLocaleString("ru-RU")}. ` : ""}
        Правило строгое: лайки в 10 раз выше обычного у автора или комментарии, где половина — «где купить», «цена», «ссылка».
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {onlyStrong && <button type="button" onClick={onAllVerdicts} className={linkButton}>Показать и «залетает»</button>}
        {days < 30 && <button type="button" onClick={onWiden} className={linkButton}>За 30 дней</button>}
      </div>
    </section>
  );
}

/** Правило словами — свёрнуто, чтобы не занимать экран телефона. */
export function SocialRule() {
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700">
      <summary className="flex h-11 cursor-pointer items-center font-medium text-slate-900">Как считаем «залетает»</summary>
      <ul className="flex list-disc flex-col gap-1 pb-3 pl-5 leading-6">
        <li>Рилсу от 2 до 21 дня; замеры — первый, на 3-й и на 7-й день (лайки, комментарии, просмотры — факт площадки, большие числа Instagram округляет).</li>
        <li>«Залетает»: лайков в 10 раз больше обычного у автора (медиана 12 последних постов) и не меньше 1 000 — или комментариев в 5 раз больше, не меньше 30, и половина из них — «где купить», «цена», «ссылка». Оба условия — «сильный залёт».</li>
        <li>У автора меньше 6 постов с видимыми лайками — сравниваем с подписчиками, вердикт «предварительно» (гипотеза), пока вещь не покажет второй автор.</li>
        <li>Модель — по номеру товара из подписи: из нашего каталога или с карточки на сайте бренда; мужское и детское в ленту не попадают.</li>
      </ul>
    </details>
  );
}

function ModelPhoto({ card }: { card: SocialReelCard }) {
  const [stage, setStage] = useState<"direct" | "proxy" | "failed">("direct");
  const target = catalogTarget(card);
  // Картинки Instagram не показываем даже если такая ссылка попала в базу: превью — только модель с сайта бренда или из каталога.
  const direct = card.match.image && !isInstagramUrl(card.match.image) ? card.match.image : null;
  if (!direct || stage === "failed") {
    const text = !direct ? (card.match.status === "no_ref" ? "модель не определена" : "фото модели нет") : "фото не открылось";
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-slate-500">
        <ImageOff className="h-6 w-6" />
        <span className="text-xs">{text}</span>
      </span>
    );
  }
  // Фото — с сайта бренда или из каталога; не открылось — у модели каталога один раз через панель (прокси без сохранения).
  const src = stage === "direct" ? direct : `/api/assortment-development/catalog/photo?source=${encodeURIComponent(target?.sourceId ?? "")}&item=${encodeURIComponent(target?.itemId ?? "")}&n=0`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={card.match.title ?? "Фото модели"}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "direct" && target ? "proxy" : "failed"))}
      className="h-full w-full object-contain"
    />
  );
}

const TONE_CLASS = { ok: "text-emerald-700", warn: "text-amber-800", muted: "text-slate-500" } as const;

/** Карточка рилса: модель, числа с происхождением, привязка, ссылки и действия. Чистая разметка — проверяется статическим рендером. */
export function SocialReelCardView({ card, local, onPick, onHideModel, onHideReel, onRestore, onAdd }: {
  card: SocialReelCard;
  local: CardLocal;
  onPick: () => void;
  onHideModel: () => void;
  onHideReel: () => void;
  onRestore: () => void;
  onAdd: () => void;
}) {
  const title = cardTitle(card);
  const match = matchLabel(card.match.status);
  const target = catalogTarget(card);
  const brandUrl = importableBrandUrl(card);
  const samples = sampleLinksFor(card);
  const busy = Boolean(local.busy);
  if (local.hidden) {
    return (
      <li className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center">
        <span className="break-anywhere line-clamp-2 text-xs text-slate-500">{title.text}</span>
        <span className="text-sm text-slate-700">{local.hidden === "model" ? "Скрыто: модель — из каталога, рилс — из ленты" : "Рилс скрыт из ленты"}</span>
        <button type="button" onClick={onRestore} disabled={busy} className={`${linkButton} disabled:opacity-60`}>
          <Undo2 className="h-4 w-4" /> Вернуть
        </button>
        {local.error && <span role="alert" className="text-xs text-red-700">{local.error}</span>}
      </li>
    );
  }
  const facts = [
    card.views != null ? `${compactRu(card.views)} просмотров` : null,
    card.likesHidden ? "лайки скрыты автором" : card.likes != null ? `${compactRu(card.likes)} лайков` : null,
    card.comments != null ? `${compactRu(card.comments)} ${plural(card.comments, "комментарий", "комментария", "комментариев")}` : null,
  ].filter(Boolean);
  const rounded = card.kinds.likes === "estimate" || card.kinds.views === "estimate";
  const ratios = [
    card.likesRatio != null ? `лайков ${timesPhrase(card.likesRatio)}` : null,
    card.commentsRatio != null ? `комментариев ${timesPhrase(card.commentsRatio)}` : null,
  ].filter(Boolean);
  const intentPct = card.intent?.share != null ? Math.round(card.intent.share * 100) : null;
  const authors = card.sameRefAuthors14d;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex gap-3">
        <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-xl bg-[#f4f2ee] sm:w-28">
          <ModelPhoto card={card} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${card.verdict === "strong" ? "bg-rose-100 text-rose-800" : "bg-orange-100 text-orange-800"}`}>{VERDICT_LABEL[card.verdict]}</span>
            {card.preliminary && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{card.confirmedBySecondAuthor ? "подтвердил второй автор" : "предварительно"}</span>}
            {card.brand && <span className="text-xs font-medium text-slate-600">{BRAND_LABEL[card.brand]}</span>}
          </div>
          <div className="break-anywhere line-clamp-3 text-sm font-medium leading-5 text-slate-900">{title.fromCaption ? `«${title.text}»` : title.text}</div>
          {title.fromCaption && <div className="text-xs text-slate-500">выдержка из подписи автора</div>}
          <div className={`text-xs font-medium ${TONE_CLASS[match.tone]}`}>
            {match.text}
            {card.match.status === "brand_site" && card.match.gender === "unknown" ? <span className="font-normal text-slate-500"> · пол на карточке не указан</span> : null}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm leading-5 text-slate-700">
        {facts.length > 0 && (
          <li>
            {facts.join(" · ")}{" "}
            <span className={kindTag}>— {KIND_TEXT.fact} площадки{rounded ? ", Instagram округляет" : ""}{card.lastCheckedAt ? `, замер ${dm(card.lastCheckedAt)}` : ""}</span>
          </li>
        )}
        {ratios.length > 0 && (
          <li>
            {`${ratios.join(", ")} выше обычного у автора`.replace(/^./, (c) => c.toUpperCase())}{" "}
            <span className={kindTag}>— {card.preliminary ? `${KIND_TEXT.hypothesis}: мало постов у автора` : KIND_TEXT.calc}</span>
          </li>
        )}
        {ratios.length === 0 && card.preliminary && (
          <li>Мало постов у автора — сравнили с подписчиками <span className={kindTag}>— {KIND_TEXT.hypothesis}</span></li>
        )}
        {intentPct != null && card.intent && (
          <li>
            «Где купить», «цена», «ссылка» — {intentPct}% комментариев (из {card.intent.total} видимых){" "}
            <span className={kindTag}>— {KIND_TEXT.estimate}</span>
          </li>
        )}
        {card.refs.length > 0 && (
          <li>
            {authors >= 2 ? `Вещь показали ${authors} ${plural(authors, "автор", "автора", "авторов")} за 14 дней` : "Пока вещь показал один автор (за 14 дней)"}{" "}
            <span className={kindTag}>— {KIND_TEXT.calc} по номеру товара</span>
          </li>
        )}
        <li className="text-xs text-slate-500">
          {card.publishedAt ? `Опубликован ${dm(card.publishedAt)} (по коду рилса)` : "Дата публикации неизвестна"}
          {/* Автор — текстом: ссылка на профиль (с целью нажатия 44 px) — в списке аккаунтов ниже. */}
          {card.author.handle ? ` · @${card.author.handle}${card.author.kind && card.author.kind !== "unknown" ? `, ${ACCOUNT_KIND_LABEL[card.author.kind]}` : ""}` : ""}
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <a href={card.url} target="_blank" rel="noopener noreferrer" className={linkButton}>
          <ExternalLink className="h-4 w-4" /> Рилс
        </a>
        {target && (local.picked ? (
          <Link href={local.picked.href} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-50 px-3 text-sm font-medium text-violet-800 hover:bg-violet-100">
            <Check className="h-4 w-4" /> {local.picked.label} · открыть
          </Link>
        ) : (
          <button type="button" onClick={onPick} disabled={busy} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-700 px-3 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Отобрать
          </button>
        ))}
        {!target && brandUrl && (local.added ? (
          <Link href={local.added.href} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-50 px-3 text-sm font-medium text-violet-800 hover:bg-violet-100">
            <Check className="h-4 w-4" /> В находках · открыть
          </Link>
        ) : (
          <button type="button" onClick={onAdd} disabled={busy} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-violet-700 px-3 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Добавить в находки
          </button>
        ))}
        {!local.picked && !local.added && (
          <button type="button" onClick={target ? onHideModel : onHideReel} disabled={busy} className={`${linkButton} disabled:opacity-60`}>
            <EyeOff className="h-4 w-4" /> Не интересно
          </button>
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

// ---------------------------------------------------------------------------
// Наблюдаемые аккаунты (свёрнутый блок внизу вкладки)

type AccountsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; data: SocialAccountsResult; canEdit: boolean };

export function SocialAccounts({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<AccountsState>({ kind: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    fetch("/api/assortment-development/social/accounts", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (cancelled) return;
        if (!response.ok) return setState({ kind: "error", message: typeof body.error === "string" ? body.error : `Список не загрузился (${response.status})` });
        if (body.available === false) return setState({ kind: "unavailable", reason: String(body.reason ?? "") });
        setState({ kind: "ready", data: { accounts: Array.isArray(body.accounts) ? (body.accounts as SocialAccountView[]) : [], seen: Number(body.seen) || 0 }, canEdit: body.canEdit === true });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  const act = async (key: string, method: "POST" | "PATCH", body: unknown) => {
    if (busy) return false;
    setBusy(key);
    setError(null);
    try {
      await send("/api/assortment-development/social/accounts", method, body);
      setReloadKey((k) => k + 1);
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex h-11 cursor-pointer items-center text-sm font-medium text-slate-900">
        Наблюдаемые аккаунты{state.kind === "ready" ? ` · ${state.data.accounts.filter((a) => a.status === "watched").length}` : ""}
      </summary>
      <div className="pb-3">
        {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем…</div>}
        {state.kind === "error" && <div role="alert" className="text-sm text-amber-900">{state.message}</div>}
        {state.kind === "unavailable" && <div className="text-sm text-slate-600">{state.reason}</div>}
        {state.kind === "ready" && (
          <SocialAccountsList
            data={state.data}
            canEdit={state.canEdit}
            busy={busy}
            error={error}
            onExclude={(handle) => void act(handle, "PATCH", { handle, action: "exclude" })}
            onRestore={(handle) => void act(handle, "PATCH", { handle, action: "restore" })}
            onAdd={(handle, kind) => act("__add", "POST", { handle, kind })}
          />
        )}
      </div>
    </details>
  );
}

/** Список аккаунтов: ник со ссылкой, вид, когда проверяли, сколько залётов; исключить / вернуть / добавить — только директору. */
export function SocialAccountsList({ data, canEdit, busy, error, onExclude, onRestore, onAdd }: {
  data: SocialAccountsResult;
  canEdit: boolean;
  busy: string | null;
  error: string | null;
  onExclude: (handle: string) => void;
  onRestore: (handle: string) => void;
  onAdd: (handle: string, kind: AccountKind) => Promise<boolean>;
}) {
  const [handle, setHandle] = useState("");
  const [kind, setKind] = useState<AccountKind>("unknown");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    if (await onAdd(handle.trim(), kind)) {
      setHandle("");
      setKind("unknown");
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-slate-500">
        Публичные аккаунты стилистов, байеров, перепродавцов и брендов — источники рилсов; профиль обходится раз в неделю.
        {data.seen > 0 ? ` Ещё ${data.seen} ${plural(data.seen, "автор встречался", "автора встречались", "авторов встречались")} в выдаче — станут наблюдаемыми после второго появления за 30 дней.` : ""}
      </p>
      {data.accounts.length === 0 ? (
        <div className="text-sm text-slate-600">Аккаунтов пока нет — стартовые появятся после первого прогона сбора.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.accounts.map((a) => (
            <li key={a.handle} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="break-anywhere inline-flex min-h-11 items-center text-sm font-medium text-violet-700 hover:text-violet-900">@{a.handle}</a>
              <span className="text-xs text-slate-500">{ACCOUNT_KIND_LABEL[a.kind]} · {ACCOUNT_ORIGIN_LABEL[a.origin]}</span>
              <span className="text-xs text-slate-500">{a.lastCheckedAt ? `проверяли ${dm(a.lastCheckedAt)}` : "ещё не проверяли"}</span>
              <span className="text-xs text-slate-700">залётов: {a.viral}</span>
              {a.status === "excluded" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">исключён</span>}
              {a.lastError && <span className="break-anywhere text-xs text-amber-800">{a.lastError}</span>}
              {canEdit && (a.status === "excluded" ? (
                <button type="button" onClick={() => onRestore(a.handle)} disabled={busy !== null} className={`${linkButton} ml-auto disabled:opacity-60`}>
                  <Undo2 className="h-4 w-4" /> Вернуть
                </button>
              ) : (
                <button type="button" onClick={() => onExclude(a.handle)} disabled={busy !== null} aria-label={`Исключить @${a.handle}`} className={`${linkButton} ml-auto disabled:opacity-60`}>
                  <UserX className="h-4 w-4" /> Исключить
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="ник или ссылка на профиль Instagram"
            aria-label="Ник или ссылка на профиль Instagram"
            className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 sm:flex-1 lg:text-sm"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} aria-label="Вид аккаунта" className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 lg:text-sm">
            {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
          </select>
          <button type="submit" disabled={busy !== null} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
            {busy === "__add" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Добавить
          </button>
        </form>
      )}
      {error && <div role="alert" className="text-xs leading-5 text-red-700">{error}</div>}
    </div>
  );
}
