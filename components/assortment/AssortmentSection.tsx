"use client";

import Link from "next/link";
import { GitCompare, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ASSORTMENT_BASE_PATH,
  ASSORTMENT_LAST_SECTION_KEY,
  DIRECTION_BRANDS,
  DIRECTION_LABEL,
  type AssortmentDirection,
} from "@/lib/assortment/constants";
import { summarizeCoverage } from "@/lib/assortment/coverage";
import { plural } from "@/lib/warehouse/plural";
import type { FeedCard, FeedView } from "@/lib/assortment/feed";
import { AddFindingModal } from "./AddFindingModal";
import { DEFAULT_CATALOG_FILTERS, isFeedView, type CatalogFilters, type SectionView } from "@/lib/assortment/catalog";
import { initialNav, navAfterMenu, navDismissRejected, navOpenWholeCatalog, navSetFilters, navSetView, navShowModels, urlForView, type CatalogNav } from "@/lib/assortment/catalogNav";
import { isSectionMenuTarget, onMenuNavigate } from "@/lib/assortment/menuSignal";
import { CatalogView } from "./CatalogView";
import { ChangesView } from "./ChangesView";
import { FormsView } from "./FormsView";
import { FeedGrid } from "./FeedGrid";
import { SocialView } from "./SocialView";
import { useAssortmentSources } from "./useAssortmentSources";

type FeedState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  // Лента помнит, чья она: при смене вкладки список прежней вкладки не показывается под новым названием (и «находок нет» прежней —
  // как «находок нет» новой, пока запрос не вернулся).
  | { kind: "ready"; cards: FeedCard[]; view: SectionView; direction: AssortmentDirection };

/**
 * Показываем только те виды ленты, у которых уже есть данные. «Распространяется»
 * и «Растёт спрос на WB» появятся вместе с автосбором и MPSTATS — до этого
 * вкладок нет вовсе, а не пустые.
 */
const VIEWS: Array<{ id: FeedView; label: string; empty: string }> = [
  { id: "new", label: "Новинки", empty: "Добавьте первую находку: ссылку на товар, публикацию или пин, либо фото." },
  { id: "work", label: "В работе", empty: "Здесь будут отобранные модели, модели, по которым нужен образец, и модели в подборках. Отберите модель в «Новинках» или в «Каталогах брендов»." },
  { id: "retail", label: "Отмечено ритейлером", empty: "Пока ни один сайт не пометил находки как новинку или бестселлер." },
  { id: "ru", label: "Рынок РФ", empty: "Замер рынка WB и Lime на WB идёт по понедельникам — первый ещё не прошёл." },
  { id: "hidden", label: "Скрытые и отклонённые", empty: "Скрытых и отклонённых моделей нет." },
];

const MAX_COMPARE = 6;


/** Раздел модуля «Разработка ассортимента»: лента находок. */
export function AssortmentSection({
  direction,
  initialView = "new",
  initialCatalogFilters = DEFAULT_CATALOG_FILTERS,
  rejectedForm = null,
}: {
  direction: AssortmentDirection;
  /** Вид и фильтры каталога из адреса — их читает серверная страница: без лишнего запроса и мигания. */
  initialView?: SectionView;
  initialCatalogFilters?: CatalogFilters;
  /** Ключ формы из адреса, которого раздел не знает: фильтр по форме не применён, и об этом говорит плашка (пока её не закрыли или не выбрали форму). */
  rejectedForm?: string | null;
}) {
  const sources = useAssortmentSources(direction);
  // Вкладка и фильтры каталога живут здесь: возвращаясь на вкладку, человек попадает на то же место (а не к начальным из адреса, из-за
  // чего сброшенная форма «залипала» и возвращалась); переходы — чистые функции catalogNav.
  const [nav, setNav] = useState<CatalogNav>(() => initialNav(initialView, initialCatalogFilters, rejectedForm));
  const view = nav.view;
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  // Число не посчиталось (ошибка, нет миграции): «неизвестно» — не «моделей нет», вкладки остаются (без числа), а не исчезают молча.
  const [catalogCountFailed, setCatalogCountFailed] = useState(false);
  const onCatalogFilters = useCallback((filters: CatalogFilters) => setNav((cur) => navSetFilters(cur, filters)), []);
  const onDismissRejected = useCallback(() => setNav((cur) => navDismissRejected(cur)), []);

  // Вид — в адресе (?view=catalog): после карточки модели возвращаемся туда же.
  const goTo = (next: CatalogNav) => {
    setNav(next);
    window.history.replaceState(null, "", urlForView(window.location.href, next.view));
  };
  const setView = (next: SectionView) => goTo(navSetView(nav, next));
  const showModels = (form: string) => goTo(navShowModels(nav, form));
  const openWholeCatalog = () => goTo(navOpenWholeCatalog(nav));

  // Сколько моделей в каталогах брендов раздела — для вкладки (нет моделей — нет вкладки).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assortment-development/catalog?direction=${direction}&count=1&photo=all`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (typeof body?.total === "number") {
          setCatalogTotal(body.total);
          setCatalogCountFailed(false);
        } else setCatalogCountFailed(true);
      })
      .catch(() => {
        if (!cancelled) setCatalogCountFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);
  // «Залетает в соцсетях»: вкладка — только когда таблицы есть и сбор хоть что-то записал (иначе её нет); число — «залетевших» за 14 дней.
  const [social, setSocial] = useState<{ total: number; collected: number } | null>(null);
  const [socialCountFailed, setSocialCountFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assortment-development/social?direction=${direction}&count=1`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok && body?.available === false) {
          setSocial(null);
          setSocialCountFailed(false);
        } else if (ok && typeof body?.collected === "number") {
          setSocial({ total: Number(body.total) || 0, collected: body.collected });
          setSocialCountFailed(false);
        } else setSocialCountFailed(true);
      })
      .catch(() => {
        if (!cancelled) setSocialCountFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);
  // «Изменения» (появилось / пропало): вкладка — когда хотя бы у одного полного источника «появилось/пропало» уже наблюдение.
  const [changesVisible, setChangesVisible] = useState(false);
  const [changesCountFailed, setChangesCountFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assortment-development/changes?direction=${direction}&count=1`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok && typeof body?.visible === "boolean") {
          setChangesVisible(body.visible);
          setChangesCountFailed(false);
        } else setChangesCountFailed(true);
      })
      .catch(() => {
        if (!cancelled) setChangesCountFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);
  const [feed, setFeed] = useState<FeedState>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  // Пункт меню своего раздела: начать заново — «Новинки», фильтры по умолчанию, без выбранного для сравнения. Адрес чистым сделает
  // сам переход по ссылке меню (сигнал приходит до него).
  const sectionHref = `${ASSORTMENT_BASE_PATH}/${direction}`;
  useEffect(() => onMenuNavigate(window, (href) => {
    if (!isSectionMenuTarget(href, sectionHref)) return;
    setNav((cur) => navAfterMenu(cur, href, sectionHref));
    setSelected(new Set());
    setActionError(null);
  }), [sectionHref]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_COMPARE) next.add(id);
    return next;
  });

  const quickAction = async (card: FeedCard, action: "archived" | "restore") => {
    setBusyId(card.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/assortment-development/references/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: card.version }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не получилось (${response.status})`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSORTMENT_LAST_SECTION_KEY, direction);
    } catch {
      // Без хранилища корень модуля просто откроет «Куртки».
    }
  }, [direction]);

  useEffect(() => {
    if (!isFeedView(view)) return;
    let cancelled = false;
    setFeed((prev) => (prev.kind === "ready" && prev.view === view && prev.direction === direction ? prev : { kind: "loading" }));
    fetch(`/api/assortment-development/references?direction=${direction}&view=${view}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setFeed({ kind: "error", message: body?.error || `Лента не загрузилась (${response.status})` });
          return;
        }
        setFeed({ kind: "ready", cards: Array.isArray(body?.cards) ? body.cards : [], view, direction });
      })
      .catch(() => {
        if (!cancelled) setFeed({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction, view, reloadKey]);

  // Лента другой вкладки — ещё не «готова» для этой.
  const shownFeed: FeedState = feed.kind === "ready" && (feed.view !== view || feed.direction !== direction) ? { kind: "loading" } : feed;
  const coverage = sources.kind === "ready" ? summarizeCoverage(sources.sources) : null;
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  // Вкладка каталога — в конце ряда: появляется после подсчёта и ничего не сдвигает под пальцем.
  const tabs: Array<{ id: SectionView; label: string }> = [
    ...VIEWS,
    ...(catalogTotal || catalogCountFailed || view === "catalog" ? [{ id: "catalog" as const, label: catalogTotal ? `Каталоги брендов · ${catalogTotal.toLocaleString("ru-RU")}` : "Каталоги брендов" }] : []),
    // «Формы» разбирают каталог — нет моделей, нет и вкладки (прячем, а не серим).
    ...(catalogTotal || catalogCountFailed || view === "forms" ? [{ id: "forms" as const, label: "Формы" }] : []),
    // «Залетает» — когда сбор рилсов уже что-то записал; число не посчиталось — вкладка без числа (сбой назовёт сама вкладка).
    ...(social?.collected || socialCountFailed || view === "social" ? [{ id: "social" as const, label: social?.total ? `Залетает · ${social.total.toLocaleString("ru-RU")}` : "Залетает" }] : []),
    // «Изменения» — когда «появилось/пропало» где-то уже наблюдение (и после 28 дней, при «динамике», тоже); журнала нет — вкладки нет.
    ...(changesVisible || changesCountFailed || view === "changes" ? [{ id: "changes" as const, label: "Изменения" }] : []),
  ];

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold text-slate-900">{DIRECTION_LABEL[direction]}</h1>
            <div className="text-sm text-slate-500">{DIRECTION_BRANDS[direction]}</div>
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800"
          >
            <Plus className="h-4 w-4" /> Добавить находку
          </button>
        </header>

        {sources.kind === "error" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{sources.message}</div>
        )}
        {coverage && (
          <p className="text-sm leading-6 text-slate-600">
            {coverage.auto.length > 0 ? `Отслеживаем автоматически: ${coverage.auto.join(", ")}.` : "Автоматический сбор пока не подключён."}
            {coverage.partial.length > 0 && ` Частично: ${coverage.partial.join(", ")}.`}
            {coverage.manual.length > 0 && ` Только вручную: ${coverage.manual.join(", ")}.`}
            {" "}
            <Link href={`${ASSORTMENT_BASE_PATH}/sources`} className="font-medium text-violet-700 hover:text-violet-900">Все источники</Link>
          </p>
        )}

        <div role="tablist" aria-label="Вид ленты" className="-mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          {tabs.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view}
              onClick={() => setView(v.id)}
              className={`h-10 shrink-0 rounded-full px-4 text-sm ${v.id === view ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "catalog" && <CatalogView key={nav.key} direction={direction} initialFilters={nav.filters} onFiltersChange={onCatalogFilters} rejectedForm={nav.rejected} onDismissRejected={onDismissRejected} />}
        {view === "forms" && <FormsView direction={direction} onShowModels={showModels} />}
        {view === "social" && <SocialView key={direction} direction={direction} />}
        {view === "changes" && <ChangesView key={direction} direction={direction} />}
        {isFeedView(view) && shownFeed.kind === "loading" && <div className="text-sm text-slate-500">Загружаем ленту…</div>}
        {isFeedView(view) && shownFeed.kind === "error" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{shownFeed.message}</div>
        )}
        {actionError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</div>
        )}
        {view === "new" && catalogTotal ? (
          <p className="text-sm leading-6 text-slate-600">
            Здесь только то, что появилось у брендов после первого обхода.{" "}
            <button type="button" onClick={openWholeCatalog} className="font-medium text-violet-700 hover:text-violet-900">
              Весь ассортимент брендов — {catalogTotal.toLocaleString("ru-RU")} {plural(catalogTotal, "модель", "модели", "моделей")}
            </button>
          </p>
        ) : null}
        {isFeedView(view) && shownFeed.kind === "ready" && shownFeed.cards.length > 0 && (
          <FeedGrid
            cards={shownFeed.cards}
            direction={direction}
            selected={selected}
            selectionFull={selected.size >= MAX_COMPARE}
            busyId={busyId}
            onToggle={toggle}
            onQuickAction={quickAction}
          />
        )}
        {isFeedView(view) && shownFeed.kind === "ready" && shownFeed.cards.length === 0 && (
          <section className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <div className="text-base font-semibold text-slate-900">Находок пока нет</div>
            <p className="max-w-xl text-sm leading-6 text-slate-600">{current.empty}</p>
          </section>
        )}
        {selected.size > 0 && (
          <div className="action-bar -mx-3 flex items-center justify-between gap-3 px-3 pt-3 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
            <span className="text-sm text-slate-700">
              Выбрано {selected.size} из {MAX_COMPARE}{selected.size < 2 && " — для сравнения нужно хотя бы две"}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected(new Set())} aria-label="Сбросить выбор" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                <X className="h-4 w-4" />
              </button>
              {selected.size >= 2 && (
                <Link
                  href={`${ASSORTMENT_BASE_PATH}/${direction}/compare?ids=${[...selected].join(",")}`}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800"
                >
                  <GitCompare className="h-4 w-4" /> Сравнить
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      <AddFindingModal open={adding} direction={direction} onClose={() => setAdding(false)} onImported={reload} />
    </div>
  );
}
