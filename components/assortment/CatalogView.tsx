"use client";

import Link from "next/link";
import { Check, EyeOff, ExternalLink, ImageOff, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { CatalogBrandStat, CatalogCard, CatalogFilters } from "@/lib/assortment/catalog";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "@/lib/assortment/constants";
import { isReferenceStatus, STATUS_LABEL } from "@/lib/assortment/decisions";
import { plural } from "@/lib/warehouse/plural";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; cards: CatalogCard[]; total: number; brands: CatalogBrandStat[] | null; photo: "with" | "all"; photosPending: boolean; loadingMore: boolean };

const PAGE = 48;
const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });

/** Фильтры — в адресе: после карточки модели и перезагрузки возвращаемся на то же место. */
function writeFilters(filters: CatalogFilters) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string | null) => (value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
  set("source", filters.source);
  set("q", filters.q.trim() || null);
  set("fresh", filters.fresh ? "1" : null);
  set("badge", filters.badge ? "1" : null);
  set("photo", filters.photo === "auto" ? null : filters.photo);
  window.history.replaceState(null, "", url);
}

function query(direction: AssortmentDirection, filters: CatalogFilters, offset: number, photo: CatalogFilters["photo"]) {
  const params = new URLSearchParams({ direction, offset: String(offset), limit: String(PAGE) });
  if (filters.source) params.set("source", filters.source);
  if (filters.q.trim().length >= 2) params.set("q", filters.q.trim());
  if (filters.fresh) params.set("fresh", "1");
  if (filters.badge) params.set("badge", "1");
  if (photo !== "auto") params.set("photo", photo);
  return `/api/assortment-development/catalog?${params}`;
}

/**
 * «Каталоги брендов»: всё, что обходы собрали у брендов в разделе, а не только
 * новинки. Фото грузятся с сайта бренда в браузере; не открылось — панель
 * приносит его один раз сама.
 */
export function CatalogView({ direction, initialFilters }: { direction: AssortmentDirection; initialFilters: CatalogFilters }) {
  const [filters, setFilters] = useState<CatalogFilters>(initialFilters);
  const [search, setSearch] = useState(initialFilters.q);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [viewer, setViewer] = useState<CatalogCard | null>(null);
  // «Занято» — у каждой карточки своё: второе нажатие на другой карточке не размораживает первую.
  const busyRef = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [cardError, setCardError] = useState<{ key: string; message: string } | null>(null);
  const cardKey = (c: CatalogCard) => `${c.sourceId}:${c.itemId}`;
  const begin = (key: string) => {
    if (busyRef.current.has(key)) return false;
    busyRef.current.add(key);
    setBusy(new Set(busyRef.current));
    setCardError((e) => (e?.key === key ? null : e));
    return true;
  };
  const end = (key: string) => {
    busyRef.current.delete(key);
    setBusy(new Set(busyRef.current));
  };
  const patchCard = (key: string, patch: Partial<CatalogCard>) => setState((cur) => (cur.kind === "ready"
    ? { ...cur, cards: cur.cards.map((c) => (cardKey(c) === key ? { ...c, ...patch } : c)) }
    : cur));

  /** «Отобрать»: модель становится находкой со статусом «Отобрана» (или показывает свой настоящий статус). */
  const pick = async (card: CatalogCard) => {
    const key = cardKey(card);
    if (!begin(key)) return;
    try {
      const response = await fetch("/api/assortment-development/catalog/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: card.sourceId, itemId: card.itemId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body?.referenceId !== "string") throw new Error(body?.error || `Не получилось отобрать (${response.status})`);
      patchCard(key, { referenceId: body.referenceId, referenceStatus: typeof body.status === "string" ? body.status : null });
    } catch (e) {
      setCardError({ key, message: e instanceof Error ? e.message : "Не получилось отобрать" });
    } finally {
      end(key);
    }
  };

  /** «Не интересно» и «Вернуть»: модель уходит из выдачи каталога (для всех) — с возможностью сразу вернуть. */
  const setHidden = async (card: CatalogCard, hidden: boolean) => {
    const key = cardKey(card);
    if (!begin(key)) return;
    try {
      const response = await fetch("/api/assortment-development/catalog/hide", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: card.sourceId, itemId: card.itemId, hidden }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не получилось (${response.status})`);
      patchCard(key, { hiddenLocal: hidden });
      setState((cur) => (cur.kind === "ready" ? { ...cur, total: Math.max(0, cur.total + (hidden ? -1 : 1)) } : cur));
    } catch (e) {
      setCardError({ key, message: e instanceof Error ? e.message : "Не получилось" });
    } finally {
      end(key);
    }
  };

  // Номер поколения фильтров: ответ «Показать ещё» от старых фильтров отбрасывается.
  const generation = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const id = window.setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    writeFilters(filters);
    setState((prev) => (prev.kind === "ready" ? { ...prev, loadingMore: true } : { kind: "loading" }));
    fetch(query(direction, filters, 0, filters.photo), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setState({ kind: "error", message: body?.error || `Каталог не загрузился (${response.status})` });
          return;
        }
        setState({
          kind: "ready",
          cards: Array.isArray(body.cards) ? body.cards : [],
          total: typeof body.total === "number" ? body.total : 0,
          brands: Array.isArray(body.brands) ? body.brands : null,
          photo: body.photo === "with" ? "with" : "all",
          photosPending: Boolean(body.photosPending),
          loadingMore: false,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction, filters]);

  const loadMore = useCallback(() => {
    const prev = stateRef.current;
    if (prev.kind !== "ready" || prev.loadingMore || prev.cards.length >= prev.total) return;
    const gen = generation.current;
    const key = (c: CatalogCard) => `${c.sourceId}:${c.itemId}`;
    setState({ ...prev, loadingMore: true });
    // Режим фото — тот, что сервер выбрал для первой порции: страницы не должны разойтись.
    fetch(query(direction, filters, prev.cards.length, prev.photo), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (gen !== generation.current) return;
        setState((cur) => {
          if (cur.kind !== "ready") return cur;
          if (!Array.isArray(body?.cards)) return { ...cur, loadingMore: false };
          const seen = new Set(cur.cards.map(key));
          return { ...cur, cards: [...cur.cards, ...body.cards.filter((c: CatalogCard) => !seen.has(key(c)))], loadingMore: false };
        });
      })
      .catch(() => {
        if (gen === generation.current) setState((cur) => (cur.kind === "ready" ? { ...cur, loadingMore: false } : cur));
      });
  }, [direction, filters]);

  // Наблюдатель вешается на сам элемент при его появлении — и после пустого результата тоже.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  const observer = useRef<IntersectionObserver | null>(null);
  const sentinel = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof IntersectionObserver === "undefined") return;
    observer.current = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
    }, { rootMargin: "800px 0px" });
    observer.current.observe(node);
  }, []);

  const ready = state.kind === "ready" ? state : null;
  const photoOnly = ready?.photo === "with";
  const shown = (b: CatalogBrandStat) => (photoOnly ? b.withPhoto : b.models);
  const brands = (ready?.brands ?? []).filter((b) => shown(b) > 0 || b.sourceId === filters.source);
  const allCount = ready?.brands ? ready.brands.reduce((s, b) => s + shown(b), 0) : null;
  const selectedBrand = ready?.brands?.find((b) => b.sourceId === filters.source) ?? null;
  const hiddenWithoutPhoto = photoOnly && ready?.brands
    ? (selectedBrand ? selectedBrand.models - selectedBrand.withPhoto : ready.brands.reduce((s, b) => s + b.models - b.withPhoto, 0))
    : 0;
  const chip = (active: boolean) => `h-10 shrink-0 rounded-full px-4 text-sm ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-slate-600">
        Всё, что бренды продают сейчас, по данным обходов. «Новинки» — только то, что появилось после первого обхода; здесь — весь собранный ассортимент.
      </p>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию или бренду"
          aria-label="Поиск по названию или бренду"
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-base text-slate-900 lg:text-sm"
        />
      </label>

      {brands.length > 0 && (
        <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:px-0" aria-label="Бренды">
          <button type="button" aria-pressed={!filters.source} onClick={() => setFilters((f) => ({ ...f, source: null }))} className={chip(!filters.source)}>
            Все бренды{allCount !== null && ` · ${allCount.toLocaleString("ru-RU")}`}
          </button>
          {brands.map((b) => (
            <button key={b.sourceId} type="button" aria-pressed={filters.source === b.sourceId} onClick={() => setFilters((f) => ({ ...f, source: f.source === b.sourceId ? null : b.sourceId }))} className={chip(filters.source === b.sourceId)}>
              {b.name} · {shown(b).toLocaleString("ru-RU")}
            </button>
          ))}
        </div>
      )}

      <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:px-0" aria-label="Фильтры">
        <button type="button" aria-pressed={filters.fresh} onClick={() => setFilters((f) => ({ ...f, fresh: !f.fresh }))} className={chip(filters.fresh)}>Новое за 7 дней</button>
        {ready && !ready.photosPending && (
          <>
            <button type="button" aria-pressed={filters.badge} onClick={() => setFilters((f) => ({ ...f, badge: !f.badge }))} className={chip(filters.badge)}>Метка бренда</button>
            <button type="button" aria-pressed={!photoOnly} onClick={() => setFilters((f) => ({ ...f, photo: photoOnly ? "all" : "with" }))} className={chip(!photoOnly)}>И без фото</button>
          </>
        )}
      </div>

      {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем каталоги…</div>}
      {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
      {ready?.photosPending && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Фото моделей появятся после обновления базы и ближайших обходов брендов — пока видны названия и ссылки на сайт.
        </div>
      )}

      {ready && ready.cards.length === 0 && (
        <section className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <div className="text-base font-semibold text-slate-900">Ничего не нашлось</div>
          {hiddenWithoutPhoto > 0 ? (
            <>
              <p className="max-w-xl text-sm leading-6 text-slate-600">Ещё {hiddenWithoutPhoto.toLocaleString("ru-RU")} {plural(hiddenWithoutPhoto, "модель", "модели", "моделей")} пока без фото — обходы ещё не принесли их.</p>
              <button type="button" onClick={() => setFilters((f) => ({ ...f, photo: "all" }))} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50">Показать без фото</button>
            </>
          ) : (
            <p className="max-w-xl text-sm leading-6 text-slate-600">Измените фильтры или поиск.</p>
          )}
        </section>
      )}

      {ready && ready.cards.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {ready.cards.map((card) => card.hiddenLocal ? (
              <li key={`${card.sourceId}:${card.itemId}`} className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center">
                <span className="break-anywhere line-clamp-2 text-xs text-slate-500">{card.title}</span>
                <span className="text-sm text-slate-700">Скрыто из каталога</span>
                <button type="button" onClick={() => setHidden(card, false)} disabled={busy.has(cardKey(card))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-60">Вернуть</button>
                {cardError?.key === cardKey(card) && <span role="alert" className="text-xs text-red-700">{cardError.message}</span>}
              </li>
            ) : (
              <li key={`${card.sourceId}:${card.itemId}`} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 420px" }}>
                <div className="relative aspect-[3/4] bg-[#f4f2ee]">
                  {card.images.length > 0 ? (
                    <button type="button" onClick={() => setViewer(card)} className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500" aria-label={`Фото: ${card.title}`}>
                      <CatalogImage card={card} index={0} />
                    </button>
                  ) : (
                    <NoPhoto text="фото будет позже" />
                  )}
                  {(card.isNew || card.badges.length > 0) && (
                    <span className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
                      {card.isNew && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">Новое</span>}
                      {card.badges.includes("new") && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Новинка бренда</span>}
                      {card.badges.includes("bestseller") && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Бестселлер</span>}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3 pt-2">
                  <div className="break-anywhere line-clamp-2 text-sm font-medium leading-5 text-slate-900">{card.title}</div>
                  <div className="text-xs text-slate-500">{card.brand} · в каталоге с {day(card.firstSeenAt)}{card.variants > 1 ? ` · ${card.variants} ${plural(card.variants, "вариант", "варианта", "вариантов")}` : ""}</div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    {card.referenceId && (
                      <Link href={`${ASSORTMENT_BASE_PATH}/${direction}/${card.referenceId}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-violet-50 px-3 text-xs font-medium text-violet-800 hover:bg-violet-100">
                        {isWork(card.referenceStatus) && <Check className="h-3.5 w-3.5" />}
                        {isReferenceStatus(card.referenceStatus) ? STATUS_LABEL[card.referenceStatus] : "Находка"} · открыть
                      </Link>
                    )}
                    {canPick(card) && (
                      <button type="button" onClick={() => pick(card)} disabled={busy.has(cardKey(card))} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-violet-700 px-3 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-60">
                        {busy.has(cardKey(card)) ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Отобрать
                      </button>
                    )}
                    {/* Второстепенное — значками в один ряд: карточка не растёт на три строки кнопок. */}
                    <span className="flex gap-2">
                      {!card.referenceId && !ready.photosPending && (
                        <button type="button" onClick={() => setHidden(card, true)} disabled={busy.has(cardKey(card))} aria-label={`Не интересно: ${card.title}`} title="Не интересно" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                          <EyeOff className="h-4 w-4" />
                        </button>
                      )}
                      {card.productUrl && (
                        <a href={card.productUrl} target="_blank" rel="noopener noreferrer" aria-label={`На сайте бренда: ${card.title}`} title="На сайте бренда" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </span>
                  </div>
                  {cardError?.key === cardKey(card) && <div role="alert" className="text-xs leading-5 text-red-700">{cardError.message}</div>}
                </div>
              </li>
            ))}
          </ul>
          <div ref={sentinel} className="flex flex-col items-center gap-2 py-2 text-sm text-slate-500">
            <span>Показано {ready.cards.length.toLocaleString("ru-RU")} из {ready.total.toLocaleString("ru-RU")}</span>
            {ready.cards.length < ready.total && (
              <button type="button" onClick={loadMore} disabled={ready.loadingMore} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                {ready.loadingMore && <LoaderCircle className="h-4 w-4 animate-spin" />} Показать ещё
              </button>
            )}
          </div>
        </>
      )}

      {viewer && (
        <Modal open onClose={() => setViewer(null)} title={viewer.title} size="lg">
          <div className="flex flex-col gap-3">
            <div className="text-sm text-slate-600">{viewer.brand}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {viewer.images.map((_, i) => (
                <div key={i} className="aspect-[3/4] overflow-hidden rounded-xl bg-[#f4f2ee]">
                  <CatalogImage card={viewer} index={i} />
                </div>
              ))}
            </div>
            {viewer.productUrl && (
              <a href={viewer.productUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 self-start rounded-xl border border-slate-300 px-4 text-sm text-slate-800 hover:bg-slate-50">
                <ExternalLink className="h-4 w-4" /> Открыть на сайте бренда
              </a>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

const WORK = new Set(["selected", "sample_needed", "in_collection"]);
const isWork = (status: string | null | undefined) => Boolean(status && WORK.has(status));
/** «Отобрать» — у модели, которой ещё нет среди находок, и у новой или отложенной находки. */
const canPick = (card: CatalogCard) => !card.referenceId || card.referenceStatus === "new" || card.referenceStatus === "watching";

function NoPhoto({ text }: { text: string }) {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
      <ImageOff className="h-7 w-7" />
      <span className="text-xs">{text}</span>
    </span>
  );
}

/** Фото с сайта бренда; не открылось — один раз через панель; снова нет — заглушка. */
function CatalogImage({ card, index }: { card: CatalogCard; index: number }) {
  const [stage, setStage] = useState<"direct" | "proxy" | "failed">("direct");
  const direct = card.images[index];
  if (!direct || stage === "failed") return <NoPhoto text={direct ? "фото не открылось" : "фото будет позже"} />;
  const src = stage === "direct" ? direct : `/api/assortment-development/catalog/photo?source=${encodeURIComponent(card.sourceId)}&item=${encodeURIComponent(card.itemId)}&n=${index}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={card.title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s === "direct" ? "proxy" : "failed"))}
      className="h-full w-full object-contain"
    />
  );
}
