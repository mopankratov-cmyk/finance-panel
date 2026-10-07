"use client";

import { ClipboardCopy, ExternalLink, ImageOff, Search } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CompanyCandidate } from "@/lib/assortment/factories1688";
import {
  FACTORY_SORTS, registryIndicators, sortFactoryCards,
  type FactoryCard, type FactoryFlag, type FactoryIndicator, type FactorySortKey,
} from "@/lib/assortment/factoryCards";
import {
  clusterByKey, FACTORY_CLUSTER_CHIPS, FACTORY_DISCLAIMER, FACTORY_PRICE_CAPTION, FACTORY_READING_GUIDE, FACTORY_WAIT_TEXT, factoryQuestionsText,
  type FactoryClusterKey, type FactorySource,
} from "@/lib/assortment/factoryGuide";
import type { CompanyRiskResponse, CompanySearchResponse, FactorySearchResponse } from "@/lib/assortment/factorySearch";
import type { ShortlistItem, ShortlistView } from "@/lib/assortment/factoryShortlist";
import {
  CHECKLIST_VALUES, checklistValueText, dateRu, dateTimeRu, FACTORY_CHECKLIST, FACTORY_READ_ONLY_WORDS, FACTORY_STATUS_LABEL, FACTORY_STATUSES, factoriesCount,
  indicatorOf, offerPriceText, priceTiersText, sellersCount, SOURCE_LEGEND, sourceStateLine, sourceTitle, splitIndicators, statusEditState, type FactoryStatus,
} from "@/lib/assortment/factoryUi";

/**
 * «Фабрики (1688)» — вкладка раздела «Сумки» (решение владельца 07.10: в Китае закупаем сумки; в «Куртках» вкладки нет). Поиск фабрик:
 * запрос по-русски → перевод на китайский (виден и правится) → чип кластера → «Найти» (два запроса к 1688). Выдача — «Фабрики (поиск
 * поставщиков)» и «Продавцы из выдачи товаров»; карточка — цены и минимальная партия (решение владельца: «по ценам я пойму качество»),
 * показатели по одному со своей меткой (Ф/З/О/Р/Ч), флаги отдельными чипами, без общего балла и без счётчика флагов; сортировка — по одному
 * показателю. «Проверить компанию» (88查) — по кнопке, только юрлица; тёзок сверяет человек. Шорт-лист: статусы ставит человек, история
 * «кто и когда», ручной чек-лист без суммы, заметка без контактов. Закупщик и директор — ищут и правят; wb_manager — только смотрит
 * (поиска и кнопок правки у него нет вовсе — прячем, а не серим). Телефон — одна колонка, сетка показателей 2×2, цели нажатия ≥ 44 px.
 */

const API = "/api/assortment-development/factories";
/** Сколько карточек блока видно сразу; дальше — «Показать ещё». */
export const FACTORY_PAGE = 6;
const HAN_RE = /\p{Script=Han}/u;

const button = "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 hover:bg-slate-50";
const primary = "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800";
const chip = (active: boolean) => `h-11 shrink-0 rounded-full px-4 text-sm ${active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
const field = "h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900";
const detailsBox = "rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:px-4";
const summaryRow = "flex min-h-11 cursor-pointer items-center font-medium text-slate-900";
const SOURCE_CLASS: Record<FactorySource, string> = {
  Ф: "bg-sky-100 text-sky-800",
  З: "bg-amber-100 text-amber-900",
  О: "bg-violet-100 text-violet-800",
  Р: "bg-emerald-100 text-emerald-800",
  Ч: "bg-slate-800 text-white",
};
const ORIGIN_LABEL: Record<FactoryCard["origin"], string> = {
  suppliers: "поиск поставщиков",
  products: "продавец из выдачи товаров",
  both: "поиск поставщиков и выдача товаров",
};
const STATUS_CLASS: Record<FactoryStatus, string> = {
  candidate: "bg-slate-100 text-slate-700",
  contacted: "bg-sky-100 text-sky-800",
  video_call: "bg-sky-100 text-sky-800",
  sample_ordered: "bg-violet-100 text-violet-800",
  sample_received: "bg-violet-100 text-violet-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

async function postJson(path: string, body: unknown, method = "POST"): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${API}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body: parsed && typeof parsed === "object" ? parsed : {} };
}

const errorText = (body: Record<string, unknown>, fallback: string) => (typeof body.error === "string" && body.error ? body.error : fallback);

// ---------------------------------------------------------------------------
// Вкладка

type ViewState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; view: ShortlistView };

export function FactoriesView() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  useEffect(() => {
    let cancelled = false;
    // Перечитываем без «Загружаем…»: выдача поиска и раскрытые блоки остаются на месте.
    fetch(`${API}/shortlist?direction=bags`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<ShortlistView> & { error?: string };
        if (cancelled) return;
        if (!response.ok || !body.tab) return setState({ kind: "error", message: body.error || `Фабрики не загрузились (${response.status})` });
        setState({ kind: "ready", view: body as ShortlistView });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className="flex flex-col gap-4">
      <FactoriesIntro />
      {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем фабрики…</div>}
      {state.kind === "error" && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
      {state.kind === "ready" && !state.view.tab.visible && <FactoriesUnavailable reason={state.view.tab.reason ?? "раздел недоступен"} />}
      {state.kind === "ready" && state.view.tab.visible && <FactoriesBody view={state.view} onReload={reload} />}
    </div>
  );
}

/** Что это и чем не является — видимым текстом. */
export function FactoriesIntro() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm leading-6 text-slate-600">
        Поиск фабрик сумок на 1688: фабрики из поиска поставщиков и продавцы из выдачи товаров. Цены и минимальная партия — с карточек 1688;
        остальные показатели — по одному, с меткой, откуда цифра. Общего балла фабрики нет.
      </p>
      <p className="text-sm font-medium leading-6 text-slate-800">{FACTORY_DISCLAIMER}</p>
    </div>
  );
}

/** Вкладка недоступна (нет ключа 1688, не «Сумки») — одна строка причины. */
export function FactoriesUnavailable({ reason }: { reason: string }) {
  return (
    <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      Фабрики 1688 недоступны: {reason}.
    </div>
  );
}

type SearchState = { kind: "idle" } | { kind: "searching" } | { kind: "error"; message: string } | { kind: "done"; resp: FactorySearchResponse };

/** Вкладка с данными: поиск (закупщик и директор), выдача, шорт-лист, вопросы фабрике, «Как читать показатели». */
export function FactoriesBody({ view, onReload, initialSearch = null }: { view: ShortlistView; onReload: () => void; initialSearch?: FactorySearchResponse | null }) {
  const [items, setItems] = useState<ShortlistItem[]>(view.items);
  useEffect(() => setItems(view.items), [view.items]);
  const [search, setSearch] = useState<SearchState>(initialSearch ? { kind: "done", resp: initialSearch } : { kind: "idle" });
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<{ key: string; message: string } | null>(null);
  const upsert = useCallback((item: ShortlistItem) => setItems((prev) => (prev.some((i) => i.id === item.id) ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item])), []);

  const runSearch = async (input: { queryZh: string; queryRu: string | null; cluster: FactoryClusterKey | null }) => {
    if (search.kind === "searching") return;
    setSearch({ kind: "searching" });
    setAddError(null);
    try {
      const res = await postJson("search", { direction: "bags", ...input });
      // Отказ поиска (нет ключа, запрос не по-китайски, потолок) приходит выдачей с причиной — показываем её, а не код ответа.
      if (typeof res.body.refused !== "undefined") setSearch({ kind: "done", resp: res.body as unknown as FactorySearchResponse });
      else setSearch({ kind: "error", message: errorText(res.body, `Поиск не удался (${res.status})`) });
    } catch {
      setSearch({ kind: "error", message: "Нет связи с сервером" });
    }
  };

  const add = async (card: FactoryCard, searchId: string) => {
    if (!card.key || adding) return;
    setAdding(card.key);
    setAddError(null);
    try {
      const res = await postJson("shortlist", { direction: "bags", searchId, key: card.key });
      if (res.ok && res.body.item) upsert(res.body.item as ShortlistItem);
      else setAddError({ key: card.key, message: errorText(res.body, `Не добавилось (${res.status})`) });
    } catch {
      setAddError({ key: card.key, message: "Нет связи с сервером" });
    } finally {
      setAdding(null);
    }
  };

  const byKey = new Map(items.map((i) => [i.factoryKey, i]));
  return (
    <>
      {view.canEdit ? (
        <FactorySearchForm busy={search.kind === "searching"} onSearch={runSearch} />
      ) : (
        <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{FACTORY_READ_ONLY_WORDS}</p>
      )}
      {search.kind === "searching" && <SearchWait />}
      {search.kind === "error" && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{search.message}</div>}
      {search.kind === "done" && (
        <FactoryResults
          resp={search.resp}
          canEdit={view.canEdit}
          shortlistAvailable={view.shortlist.available}
          shortlisted={byKey}
          adding={adding}
          addError={addError}
          onAdd={add}
          onRegistrySaved={onReload}
        />
      )}
      <ShortlistSection available={view.shortlist.available} reason={view.shortlist.reason} items={items} canEdit={view.canEdit} onItem={upsert} onReload={onReload} />
      <FactoryQuestions />
      <FactoryReadingGuide />
    </>
  );
}

// ---------------------------------------------------------------------------
// Поиск

/** Запрос по-русски → «Перевести» → китайский текст (виден и правится) → чип кластера → «Найти». Кнопки без условия не показываются. */
export function FactorySearchForm({ busy, onSearch, initial }: {
  busy: boolean;
  onSearch: (input: { queryZh: string; queryRu: string | null; cluster: FactoryClusterKey | null }) => void;
  initial?: { queryRu?: string; queryZh?: string; cluster?: FactoryClusterKey | null };
}) {
  const [queryRu, setQueryRu] = useState(initial?.queryRu ?? "");
  const [queryZh, setQueryZh] = useState(initial?.queryZh ?? "");
  const [cluster, setCluster] = useState<FactoryClusterKey | null>(initial?.cluster ?? null);
  const [translating, setTranslating] = useState(false);
  const [translateNote, setTranslateNote] = useState<string | null>(null);
  const canSearch = HAN_RE.test(queryZh) && !busy;
  const added = clusterByKey(cluster)?.query?.split(" ").filter((w) => w && !queryZh.includes(w)) ?? [];

  const translate = async () => {
    if (translating || !queryRu.trim()) return;
    setTranslating(true);
    setTranslateNote(null);
    try {
      const res = await postJson("search", { direction: "bags", mode: "translate", queryRu });
      if (typeof res.body.queryZh === "string" && res.body.queryZh) setQueryZh(res.body.queryZh);
      else setTranslateNote(cap(String(res.body.reason ?? errorText(res.body, "перевод не получился — напишите запрос по-китайски"))));
    } catch {
      setTranslateNote("Нет связи с сервером — напишите запрос по-китайски");
    } finally {
      setTranslating(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSearch) onSearch({ queryZh: queryZh.trim(), queryRu: queryRu.trim() || null, cluster });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" aria-label="Поиск фабрик на 1688">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-700">
          Что ищем — по-русски
          <div className="flex gap-2">
            <input value={queryRu} onChange={(e) => setQueryRu(e.target.value)} maxLength={200} placeholder="например, женская сумка из натуральной кожи" className={field} />
            {queryRu.trim() && (
              <button type="button" onClick={translate} className={`${button} shrink-0`} aria-busy={translating}>
                {translating ? "Переводим…" : "Перевести"}
              </button>
            )}
          </div>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-700">
          Запрос для 1688 — по-китайски (можно поправить)
          <input lang="zh" value={queryZh} onChange={(e) => setQueryZh(e.target.value)} maxLength={60} placeholder="女包 真皮" className={field} />
        </label>
      </div>
      {translateNote && <p role="status" className="text-sm text-amber-900">{translateNote}</p>}
      <div className="flex flex-col gap-1">
        <span className="text-sm text-slate-700">Кластер — по желанию, дописывается к запросу:</span>
        <div className="chip-row -mx-3 gap-2 px-3 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Кластеры">
          {FACTORY_CLUSTER_CHIPS.map((c) => (
            <button key={c.key} type="button" aria-pressed={cluster === c.key} onClick={() => setCluster(cluster === c.key ? null : c.key)} className={chip(cluster === c.key)}>
              {c.ru.split(" (")[0]} <span lang="zh">{c.zh}</span>
            </button>
          ))}
        </div>
        {cluster && <p className="text-xs leading-5 text-slate-500">{clusterByKey(cluster)?.ru} — {clusterByKey(cluster)?.hint}{added.length ? `; к запросу допишется «${added.join(" ")}»` : ""}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canSearch && (
          <button type="submit" className={primary}>
            <Search className="h-4 w-4" /> Найти
          </button>
        )}
        <span className="text-xs leading-5 text-slate-500">
          {HAN_RE.test(queryZh) ? "Два запроса к 1688: поиск поставщиков и поиск товаров. Повтор того же запроса за 7 дней — из кэша." : "Напишите запрос по-русски и нажмите «Перевести» или сразу по-китайски — появится «Найти»."}
        </span>
      </div>
    </form>
  );
}

export function SearchWait() {
  return (
    <div role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-violet-700" />
      {FACTORY_WAIT_TEXT}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Выдача

export function FactoryResults({
  resp, canEdit, shortlistAvailable, shortlisted, adding = null, addError = null, onAdd, onRegistrySaved, initialSort = "rank",
}: {
  resp: FactorySearchResponse;
  canEdit: boolean;
  shortlistAvailable: boolean;
  shortlisted: ReadonlyMap<string, ShortlistItem>;
  adding?: string | null;
  addError?: { key: string; message: string } | null;
  onAdd: (card: FactoryCard, searchId: string) => void;
  onRegistrySaved: () => void;
  initialSort?: FactorySortKey;
}) {
  const [sort, setSort] = useState<FactorySortKey>(initialSort);
  if (resp.refused || !resp.ok) {
    return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{cap(resp.reason ?? "поиск не состоялся")}</div>;
  }
  const lines = [sourceStateLine("suppliers", resp.sources.suppliers), sourceStateLine("products", resp.sources.products)];
  const searchId = resp.searchId;
  const cardProps = (card: FactoryCard) => ({
    card,
    canEdit,
    searchId: shortlistAvailable ? searchId : null,
    shortlisted: card.key ? shortlisted.get(card.key) ?? null : null,
    adding: adding !== null && adding === card.key,
    addError: addError && addError.key === card.key ? addError.message : null,
    onAdd,
    onRegistrySaved,
  });
  const empty = resp.factories.length === 0 && resp.sellers.length === 0;
  return (
    <section aria-label="Выдача 1688" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm leading-6 text-slate-600">
        <div>
          Запрос: <span lang="zh" className="font-medium text-slate-900">{resp.queryZh}</span>
          {resp.queryRu ? <span> — «{resp.queryRu}»</span> : null}
        </div>
        <div>
          {resp.fromCache ? `Из кэша от ${dateTimeRu(resp.createdAt)} — повтор за 7 дней без запросов к 1688` : `Запросов к 1688: ${resp.calls}`}
          {resp.callsToday != null ? `; сегодня ${resp.callsToday} из ${resp.dailyCap}` : ""}
        </div>
        {lines.map((l) => (
          <div key={l.text} className={l.tone === "warn" ? "text-amber-900" : undefined}>{l.text}</div>
        ))}
        {resp.notes.map((n) => (
          <div key={n} className="text-xs leading-5 text-slate-500">{cap(n)}</div>
        ))}
      </div>
      <SourceLegend />
      {empty ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-600">1688 ничего не нашёл по этому запросу — попробуйте другие слова или кластер.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm text-slate-700 sm:flex-row sm:items-center sm:gap-2">
            Сортировать по одному показателю:
            <select value={sort} onChange={(e) => setSort(e.target.value as FactorySortKey)} className="h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900">
              {(Object.keys(FACTORY_SORTS) as FactorySortKey[]).map((key) => (
                <option key={key} value={key}>{FACTORY_SORTS[key].label}</option>
              ))}
            </select>
          </label>
          {resp.factories.length > 0 && (
            <FactoryBlock title="Фабрики (поиск поставщиков)" count={factoriesCount(resp.factories.length)} cards={sortFactoryCards(resp.factories, sort)} cardProps={cardProps} />
          )}
          {resp.sellers.length > 0 && (
            <FactoryBlock
              title="Продавцы из выдачи товаров"
              count={sellersCount(resp.sellers.length)}
              hint="Названия не совпали ни с одной фабрикой поиска поставщиков: среди них бывают торговцы и перепродавцы — смотрите показатели и флаги."
              cards={sortFactoryCards(resp.sellers, sort)}
              cardProps={cardProps}
            />
          )}
        </>
      )}
    </section>
  );
}

function FactoryBlock({ title, count, hint, cards, cardProps }: {
  title: string;
  count: string;
  hint?: string;
  cards: FactoryCard[];
  cardProps: (card: FactoryCard) => Parameters<typeof FactoryCardView>[0];
}) {
  const [shown, setShown] = useState(FACTORY_PAGE);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-slate-900">{title} <span className="text-sm font-normal text-slate-500">· {count}</span></h2>
      {hint && <p className="text-sm leading-6 text-slate-600">{hint}</p>}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {cards.slice(0, shown).map((card) => <FactoryCardView key={card.key ?? `n${card.n}`} {...cardProps(card)} />)}
      </ul>
      {cards.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + FACTORY_PAGE)} className={`${button} self-start`}>
          Показать ещё {Math.min(FACTORY_PAGE, cards.length - shown)} из {cards.length - shown}
        </button>
      )}
    </section>
  );
}

/** Метка источника: буква и расшифровка (title — для мыши; на касании расшифровка — в легенде и в «Как читать показатели»). */
export function SourceBadge({ source }: { source: FactorySource }) {
  return (
    <abbr title={sourceTitle(source)} className={`inline-grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 align-middle text-[11px] font-semibold leading-none no-underline ${SOURCE_CLASS[source]}`}>
      {source}
    </abbr>
  );
}

export function SourceLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600" aria-label="Метки источников">
      {SOURCE_LEGEND.map((l) => (
        <span key={l.source} className="inline-flex items-center gap-1"><SourceBadge source={l.source} /> {l.label}</span>
      ))}
    </p>
  );
}

export function IndicatorCell({ indicator, hideNote = false }: { indicator: FactoryIndicator; hideNote?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-slate-50 px-2.5 py-2">
      <dt className="flex items-start justify-between gap-1 text-xs leading-4 text-slate-500">
        <span className="min-w-0 break-anywhere">{indicator.label}</span>
        <SourceBadge source={indicator.source} />
      </dt>
      <dd className={`break-anywhere text-sm leading-5 ${indicator.empty ? "text-slate-400" : "text-slate-900"}`}>{indicator.text}</dd>
      {indicator.basis && <dd className="text-xs leading-4 text-slate-500">{indicator.basis}</dd>}
      {indicator.note && !hideNote && <dd className="text-xs leading-4 text-slate-400">{indicator.note}</dd>}
    </div>
  );
}

/** Показатели сеткой 2×2 (телефон) — каждый отдельно со своей меткой; суммы и «итога» нет. */
export function IndicatorGrid({ indicators }: { indicators: readonly FactoryIndicator[] }) {
  if (!indicators.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
      {indicators.map((i) => <IndicatorCell key={i.key} indicator={i} />)}
    </dl>
  );
}

/** Флаги — отдельными чипами, без счётчика: красные и жёлтые, у каждого — метка источника. */
export function FlagChips({ flags }: { flags: readonly FactoryFlag[] }) {
  if (!flags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Флаги">
      {flags.map((f) => (
        <li key={f.key} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-4 ${f.level === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span aria-hidden>{f.level === "red" ? "●" : "▲"}</span>
          <span className="min-w-0 break-anywhere">{f.text}</span>
          <SourceBadge source={f.source} />
        </li>
      ))}
    </ul>
  );
}

/** Цены и минимальная партия — главное, по чему закупщик судит о товаре (решение владельца 07.10); с подписью «цена карточки, не ТЗ». */
export function PriceBlock({ indicators, tiers }: { indicators: readonly FactoryIndicator[]; tiers: Parameters<typeof priceTiersText>[0] }) {
  const prices = indicatorOf(indicators, "prices");
  const moq = indicatorOf(indicators, "moq");
  if (!prices && !moq) return null;
  const tiersText = priceTiersText(tiers);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/50 p-2">
      <dl className="grid grid-cols-2 gap-2">
        {prices && <IndicatorCell indicator={prices} hideNote />}
        {moq && <IndicatorCell indicator={moq} />}
      </dl>
      {tiersText && (
        <p className="flex flex-wrap items-center gap-1 px-1 text-sm leading-5 text-slate-800">
          Ступени цены от партии: {tiersText} <SourceBadge source="Ф" />
        </p>
      )}
      <p className="px-1 text-xs leading-4 text-slate-500">{cap(FACTORY_PRICE_CAPTION)}.</p>
    </div>
  );
}

function OfferPhoto({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-slate-500">
        <ImageOff className="h-5 w-5" />
        <span className="text-[11px]">{src ? "фото не открылось" : "фото нет"}</span>
      </span>
    );
  }
  // Фото — ссылкой на картинку 1688 (без копирования к себе); адрес страницы панели площадке не уходит.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />;
}

/** Карточки продавца в выдаче: фото, цена, партия — ссылками на 1688. Ряд едет вбок, страница — нет. */
export function OfferStrip({ offers }: { offers: FactoryCard["offers"] }) {
  if (!offers.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs text-slate-500">Карточки продавца в выдаче · {offers.length} <SourceBadge source="Ф" /></span>
      <ul className="chip-row -mx-3 gap-2 px-3 pb-1 sm:-mx-4 sm:px-4">
        {offers.slice(0, 10).map((o) => {
          const price = offerPriceText(o.priceMin, o.priceMax);
          return (
            <li key={o.offerId} className="w-28 shrink-0">
              <a href={o.detailUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-1 rounded-lg hover:bg-slate-50">
                <span className="block aspect-square w-28 overflow-hidden rounded-lg bg-[#f4f2ee]"><OfferPhoto src={o.imageUrl} alt={o.titleZh} /></span>
                {price && <span className="text-xs font-medium text-slate-900">{price}</span>}
                {o.moq != null && <span className="text-xs text-slate-500">от {o.moq.toLocaleString("ru-RU")} шт.</span>}
                <span lang="zh" className="line-clamp-2 text-xs leading-4 text-slate-600">{o.titleZh}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EntityLine({ entity }: { entity: FactoryCard["entity"] }) {
  if (entity === "company") return null;
  return (
    <p className="text-xs leading-5 text-slate-500">
      {entity === "individual" ? "ИП (个体工商户)" : "юрлицо или ИП — по названию не ясно"}: название магазина не храним и не показываем — псевдоним и ссылка.
    </p>
  );
}

/** Карточка фабрики из выдачи. Чистая разметка, кроме «Проверить компанию» (свои запросы). */
export function FactoryCardView({ card, canEdit, searchId, shortlisted, adding, addError, onAdd, onRegistrySaved }: {
  card: FactoryCard;
  canEdit: boolean;
  /** null — «В шорт-лист» нет (нет кэша поиска или миграции). */
  searchId: string | null;
  shortlisted: ShortlistItem | null;
  adding: boolean;
  addError: string | null;
  onAdd: (card: FactoryCard, searchId: string) => void;
  onRegistrySaved: () => void;
}) {
  const split = splitIndicators(card.indicators);
  const rank = indicatorOf(card.indicators, "rank");
  const canAdd = canEdit && searchId !== null && card.key !== null && !shortlisted;
  const canCheck = canEdit && card.entity === "company" && Boolean(card.name);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 lang={card.name ? "zh" : undefined} className="min-w-0 break-anywhere text-base font-semibold text-slate-900">{card.displayName}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ORIGIN_LABEL[card.origin]}</span>
        </div>
        <EntityLine entity={card.entity} />
        {rank && !rank.empty && (
          <p className="text-xs leading-5 text-slate-500">
            {rank.label}: {rank.text} <SourceBadge source={rank.source} /> — {rank.note}
          </p>
        )}
      </header>
      <FlagChips flags={card.flags} />
      <PriceBlock indicators={card.indicators} tiers={card.prices?.tiers ?? []} />
      <IndicatorGrid indicators={split.main} />
      {split.more.length + split.empty.length > 0 && (
        <details className="rounded-xl border border-slate-200 px-3 text-sm">
          <summary className={summaryRow}>Все показатели · {split.more.length + split.empty.length}</summary>
          <div className="flex flex-col gap-2 pb-3">
            <IndicatorGrid indicators={split.more} />
            {split.empty.length > 0 && <p className="text-xs leading-5 text-slate-500">Нет данных: {split.empty.map((i) => i.label).join("; ")}.</p>}
          </div>
        </details>
      )}
      <OfferStrip offers={card.offers} />
      <div className="flex flex-wrap items-center gap-2">
        {card.shopUrl && (
          <a href={card.shopUrl} target="_blank" rel="noopener noreferrer" className={button}>
            <ExternalLink className="h-4 w-4" /> Магазин на 1688
          </a>
        )}
        {canAdd && (
          <button type="button" onClick={() => onAdd(card, searchId as string)} className={primary} aria-busy={adding}>
            {adding ? "Добавляем…" : "В шорт-лист"}
          </button>
        )}
        {shortlisted && (
          <a href={`#cn-factory-${shortlisted.id}`} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm text-emerald-900 hover:bg-emerald-100">
            В шорт-листе{shortlisted.displayName !== card.displayName ? ` как «${shortlisted.displayName}»` : ""} · {shortlisted.statusLabel}
          </a>
        )}
      </div>
      {addError && <p role="alert" className="text-sm text-red-800">{cap(addError)}</p>}
      {canCheck && <CompanyCheck name={card.name as string} factoryId={shortlisted?.id ?? null} onSaved={onRegistrySaved} />}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Проверка компании (88查)

type CheckState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "candidates"; resp: CompanySearchResponse }
  | { kind: "risking"; resp: CompanySearchResponse }
  | { kind: "facts"; resp: CompanyRiskResponse }
  | { kind: "error"; message: string };

/**
 * «Проверить компанию»: шаг 1 — поиск по названию в реестре (один запрос), человек сверяет тёзок по городу и выбирает; шаг 2 — риски по
 * кредитному коду (второй запрос). С записью шорт-листа проверка сохраняется в неё (без имён и текстов дел).
 */
export function CompanyCheck({ name, factoryId, onSaved, again = false }: { name: string; factoryId: string | null; onSaved: () => void; again?: boolean }) {
  const [state, setState] = useState<CheckState>({ kind: "idle" });
  const find = async () => {
    setState({ kind: "searching" });
    try {
      const res = await postJson("check-company", { direction: "bags", step: "search", name });
      if (typeof res.body.refused !== "undefined") setState({ kind: "candidates", resp: res.body as unknown as CompanySearchResponse });
      else setState({ kind: "error", message: errorText(res.body, `Проверка не удалась (${res.status})`) });
    } catch {
      setState({ kind: "error", message: "Нет связи с сервером" });
    }
  };
  const risk = async (resp: CompanySearchResponse, candidate: CompanyCandidate) => {
    setState({ kind: "risking", resp });
    try {
      const res = await postJson("check-company", {
        direction: "bags", step: "risk", creditCode: candidate.creditCode, factoryId,
        candidate: { status: candidate.status, establishedOn: candidate.establishedOn, entType: candidate.entType, regCapText: candidate.regCapText, area: candidate.area },
      });
      if (typeof res.body.refused === "undefined") return setState({ kind: "error", message: errorText(res.body, `Проверка не удалась (${res.status})`) });
      const out = res.body as unknown as CompanyRiskResponse;
      setState({ kind: "facts", resp: out });
      if (out.savedTo) onSaved();
    } catch {
      setState({ kind: "error", message: "Нет связи с сервером" });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {state.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={find} className={button}>{again ? "Проверить компанию заново (88查)" : "Проверить компанию (88查)"}</button>
          <span className="text-xs leading-5 text-slate-500">реестр КНР: сначала поиск по названию, риски — после вашего выбора; по запросу на шаг</span>
        </div>
      )}
      {state.kind === "searching" && <p role="status" className="text-sm text-slate-600">88查 ищет компанию…</p>}
      {(state.kind === "candidates" || state.kind === "risking") && (
        <CompanyCandidates resp={state.resp} busy={state.kind === "risking"} onPick={(c) => risk(state.resp, c)} />
      )}
      {state.kind === "risking" && <p role="status" className="text-sm text-slate-600">88查 проверяет риски…</p>}
      {state.kind === "facts" && <CompanyFacts resp={state.resp} factoryId={factoryId} />}
      {state.kind === "error" && <p role="alert" className="text-sm text-red-800">{cap(state.message)}</p>}
    </div>
  );
}

/** Кандидаты из реестра: у юрлиц — название и код, у ИП — только регион и статус (название и код не храним, риски не проверяем). */
export function CompanyCandidates({ resp, busy = false, onPick }: { resp: CompanySearchResponse; busy?: boolean; onPick: (candidate: CompanyCandidate) => void }) {
  if (resp.refused || !resp.ok) return <p role="status" className="text-sm text-amber-900">{cap(resp.reason ?? "проверка не состоялась")}</p>;
  if (!resp.candidates.length) return <p role="status" className="text-sm text-slate-700">{cap(resp.reason ?? "88查 не нашёл компанию с таким названием")}</p>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
      <p className="text-sm leading-6 text-slate-700">
        Реестр КНР (88查): {resp.total != null ? `найдено ${resp.total}` : `кандидатов ${resp.candidates.length}`}. Сверьте город и район — у тёзок они разные; риски
        проверяются по коду выбранной компании.
      </p>
      <ul className="flex flex-col gap-2">
        {resp.candidates.map((c, i) => {
          const facts = [c.area, c.status, c.establishedOn ? `с ${dateRu(c.establishedOn)}` : null, c.entType, c.regCapText ? `капитал ${c.regCapText}` : null].filter(Boolean).join(" · ");
          const company = c.entity !== "individual" && Boolean(c.name);
          return (
            <li key={`${c.creditCode ?? "ip"}-${i}`} className="flex flex-col gap-1 rounded-lg bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {company ? <span lang="zh" className="break-anywhere text-sm font-medium text-slate-900">{c.name}</span> : <span className="text-sm text-slate-700">ИП (个体工商户) — название и код не храним</span>}
                {i === resp.exactIndex && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">название совпало целиком</span>}
                <SourceBadge source="Р" />
              </div>
              {facts && <span lang="zh" className="break-anywhere text-xs leading-5 text-slate-600">{facts}</span>}
              {company && c.creditCode && !busy && (
                <button type="button" onClick={() => onPick(c)} className={`${button} self-start`}>Это она — проверить риски</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CompanyFacts({ resp, factoryId }: { resp: CompanyRiskResponse; factoryId: string | null }) {
  if (resp.refused || !resp.ok || !resp.facts) return <p role="status" className="text-sm text-amber-900">{cap(resp.reason ?? "проверка не состоялась")}</p>;
  const saved = resp.savedTo ? "сохранено в шорт-лист" : factoryId ? null : "не сохранено: фабрики нет в шорт-листе — добавьте её и проверьте там";
  return (
    <RegistryView
      indicators={resp.facts.indicators}
      flags={resp.facts.flags}
      caption={[`проверено ${dateRu(resp.facts.checkedOn)}`, saved, ...resp.notes].filter(Boolean).join("; ")}
    />
  );
}

/** Факты реестра (метка Р) и красные флаги реестра. */
export function RegistryView({ indicators, flags, caption }: { indicators: readonly FactoryIndicator[]; flags: readonly FactoryFlag[]; caption: string }) {
  return (
    <section aria-label="Реестр КНР" className="flex flex-col gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-2">
      <h4 className="px-1 text-sm font-medium text-slate-900">Реестр КНР (88查) <span className="text-xs font-normal text-slate-500">— {caption}</span></h4>
      <FlagChips flags={flags} />
      <IndicatorGrid indicators={indicators} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Шорт-лист

export function ShortlistSection({ available, reason, items, canEdit, onItem, onReload }: {
  available: boolean;
  reason: string | null;
  items: readonly ShortlistItem[];
  canEdit: boolean;
  onItem: (item: ShortlistItem) => void;
  onReload: () => void;
}) {
  const active = items.filter((i) => i.status !== "rejected");
  const rejected = items.filter((i) => i.status === "rejected");
  return (
    <section aria-label="Шорт-лист фабрик" className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-slate-900">Шорт-лист фабрик{available ? <span className="text-sm font-normal text-slate-500"> · {items.length}</span> : null}</h2>
      {!available && <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{cap(reason ?? "шорт-лист недоступен")}.</p>}
      {available && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm leading-6 text-slate-600">
          Пока пусто.{" "}
          {canEdit ? "Нажмите «В шорт-лист» у фабрики из выдачи — запишется снимок её показателей и цен на сегодня." : "Фабрики добавляет закупщик из выдачи поиска."}
        </p>
      )}
      {active.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {active.map((item) => <ShortlistItemView key={item.id} item={item} canEdit={canEdit} onItem={onItem} onReload={onReload} />)}
        </ul>
      )}
      {rejected.length > 0 && (
        <details className={detailsBox}>
          <summary className={summaryRow}>Отклонённые · {rejected.length}</summary>
          <ul className="grid grid-cols-1 gap-3 pb-3 lg:grid-cols-2">
            {rejected.map((item) => <ShortlistItemView key={item.id} item={item} canEdit={canEdit} onItem={onItem} onReload={onReload} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

type PatchResult = { ok: true; item: ShortlistItem } | { ok: false; message: string; conflict: boolean };

async function sendPatch(item: ShortlistItem, patch: Record<string, unknown>): Promise<PatchResult> {
  try {
    const res = await postJson("shortlist", { id: item.id, updatedAt: item.updatedAt, ...patch }, "PATCH");
    if (res.ok && res.body.item) return { ok: true, item: res.body.item as ShortlistItem };
    return { ok: false, message: errorText(res.body, `Не сохранилось (${res.status})`), conflict: res.status === 409 };
  } catch {
    return { ok: false, message: "Нет связи с сервером", conflict: false };
  }
}

/** Запись шорт-листа: статус и история, снимок показателей и цен на дату добавления, реестр, чек-лист, заметка, ссылки. */
export function ShortlistItemView({ item, canEdit, onItem, onReload }: { item: ShortlistItem; canEdit: boolean; onItem: (item: ShortlistItem) => void; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendPatch(item, patch);
    setBusy(false);
    if (res.ok) onItem(res.item);
    else {
      setError(res.message);
      if (res.conflict) onReload();
    }
  };
  const snapshot = item.snapshot;
  const indicators = (snapshot?.indicators ?? []).filter((i) => i.key !== "prices" && i.key !== "moq" && i.key !== "rank");
  const company = item.entity === "company" && Boolean(item.name);
  return (
    <li id={`cn-factory-${item.id}`} className="flex min-w-0 scroll-mt-20 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" aria-busy={busy}>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 lang={company ? "zh" : undefined} className="min-w-0 break-anywhere text-base font-semibold text-slate-900">{item.displayName}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.status]}`}>{item.statusLabel}</span>
        </div>
        <EntityLine entity={item.entity} />
        <p className="text-xs leading-5 text-slate-500">
          Добавлена {dateTimeRu(item.createdAt)}{item.createdBy ? `, ${item.createdBy}` : ""}; снимок показателей и цен — на {dateRu(item.snapshotOn)}
          {item.queryZh ? <>, запрос <span lang="zh">«{item.queryZh}»</span></> : null}
        </p>
        {item.creditCode && (
          <p className="flex flex-wrap items-center gap-1 text-xs leading-5 text-slate-600">Единый кредитный код: {item.creditCode} <SourceBadge source="Р" /></p>
        )}
      </header>
      {item.status === "rejected" && item.rejectReason && <p className="text-sm leading-6 text-red-800">Причина отклонения: {item.rejectReason}</p>}
      {canEdit && <StatusEditor key={`${item.id}:${item.updatedAt}`} item={item} onSave={save} />}
      <StatusHistory item={item} />
      <FlagChips flags={snapshot?.flags ?? []} />
      <PriceBlock indicators={snapshot?.indicators ?? []} tiers={snapshot?.prices?.tiers ?? []} />
      {indicators.length > 0 && (
        <details className="rounded-xl border border-slate-200 px-3 text-sm">
          <summary className={summaryRow}>Показатели на {dateRu(item.snapshotOn)} · {indicators.length}</summary>
          <div className="pb-3"><IndicatorGrid indicators={indicators} /></div>
        </details>
      )}
      {item.registry && (
        <RegistryView
          indicators={registryIndicators(item.registry)}
          flags={item.registry.flags ?? []}
          caption={`проверено ${dateRu(item.registry.checkedOn)}, ${item.registry.checkedBy}`}
        />
      )}
      {canEdit && company && <CompanyCheck name={item.name as string} factoryId={item.id} onSaved={onReload} again={Boolean(item.registry)} />}
      <ChecklistView item={item} canEdit={canEdit} onSave={save} />
      <NoteView key={`note:${item.id}:${item.updatedAt}`} item={item} canEdit={canEdit} onSave={save} />
      <div className="flex flex-wrap items-center gap-2">
        {item.shopUrl && (
          <a href={item.shopUrl} target="_blank" rel="noopener noreferrer" className={button}>
            <ExternalLink className="h-4 w-4" /> Магазин на 1688
          </a>
        )}
        {(snapshot?.offers ?? []).slice(0, 3).map((o, i) => (
          <a key={o.offerId} href={o.detailUrl} target="_blank" rel="noopener noreferrer" className={button}>
            <ExternalLink className="h-4 w-4" /> Карточка {i + 1}{o.priceMin != null ? ` · ${offerPriceText(o.priceMin, o.priceMax)}` : ""}
          </a>
        ))}
      </div>
      {busy && <p role="status" className="text-sm text-slate-500">Сохраняем…</p>}
      {error && <p role="alert" className="text-sm text-red-800">{cap(error)}</p>}
    </li>
  );
}

/** Смена статуса — только человеком: выбор, для «Отклонена» — причина; «Сохранить» появляется, когда есть что сохранить. */
export function StatusEditor({ item, onSave, initial }: {
  item: ShortlistItem;
  onSave: (patch: Record<string, unknown>) => void;
  /** Начальный выбор (по умолчанию — текущий статус записи). */
  initial?: { status?: FactoryStatus; reason?: string };
}) {
  const [status, setStatus] = useState<FactoryStatus>(initial?.status ?? item.status);
  const [reason, setReason] = useState(initial?.reason ?? (item.status === "rejected" ? item.rejectReason ?? "" : ""));
  const rejecting = status === "rejected";
  const edit = statusEditState(item, status, reason);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-slate-700 sm:flex-row sm:items-center sm:gap-2">
        Статус:
        <select value={status} onChange={(e) => setStatus(e.target.value as FactoryStatus)} className="h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900">
          {FACTORY_STATUSES.map((s) => <option key={s} value={s}>{FACTORY_STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      {rejecting && (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Причина отклонения (обязательно; без телефонов, WeChat и почты)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={field} />
        </label>
      )}
      {edit.needReason && <p className="text-xs text-slate-500">Отклонить можно только с причиной — напишите её, появится «Сохранить статус».</p>}
      {edit.ready && (
        <button type="button" onClick={() => onSave({ status, reason: rejecting ? reason.trim() : null })} className={`${primary} self-start`}>
          Сохранить статус
        </button>
      )}
    </div>
  );
}

/** История статусов: кто и когда (и причина отклонения). */
export function StatusHistory({ item }: { item: ShortlistItem }) {
  if (!item.history.length) return null;
  return (
    <details className="rounded-xl border border-slate-200 px-3 text-sm">
      <summary className={summaryRow}>История статусов · {item.history.length}</summary>
      <ol className="flex flex-col gap-1 pb-3">
        {[...item.history].reverse().map((step, i) => (
          <li key={`${step.at}-${i}`} className="text-sm leading-6 text-slate-700">
            <span className="font-medium">{FACTORY_STATUS_LABEL[step.status] ?? step.status}</span> — {step.by}, {dateTimeRu(step.at)}
            {step.reason ? <span className="text-slate-600"> · причина: {step.reason}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Ручной чек-лист: каждый пункт отдельно, со своей отметкой «кто и когда»; суммы и «итога» нет — решает человек. */
export function ChecklistView({ item, canEdit, onSave }: { item: ShortlistItem; canEdit: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  return (
    <details className="rounded-xl border border-slate-200 px-3 text-sm">
      <summary className={summaryRow}>
        <span className="inline-flex items-center gap-1.5">Чек-лист проверки <SourceBadge source="Ч" /></span>
      </summary>
      <p className="text-xs leading-5 text-slate-500">Пункты раздельно, без суммы и без итога: фабрику подтверждают лицензия, видеозвонок и образец — решает человек.</p>
      <ul className="flex flex-col divide-y divide-slate-100 pb-2">
        {FACTORY_CHECKLIST.map((point) => {
          const mark = item.checklist[point.key];
          return (
            <li key={point.key} className="flex flex-col gap-1.5 py-2">
              <span className="text-sm leading-5 text-slate-800">{point.label}</span>
              {canEdit && point.kind !== "number" && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={point.label}>
                  {CHECKLIST_VALUES[point.kind].map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={mark?.value === v}
                      onClick={() => onSave({ checklist: { [point.key]: mark?.value === v ? null : v } })}
                      className={`min-h-11 rounded-lg px-3 text-sm ${mark?.value === v ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      {checklistValueText(v)}
                    </button>
                  ))}
                </div>
              )}
              {canEdit && point.kind === "number" && <NumberMark key={`${point.key}:${mark?.at ?? ""}`} value={mark?.value} onSave={(value) => onSave({ checklist: { [point.key]: value } })} />}
              {!canEdit && <span className={`text-sm ${mark ? "text-slate-900" : "text-slate-400"}`}>{mark ? checklistValueText(mark.value) : "не отмечено"}</span>}
              {mark && <span className="text-xs text-slate-500">{canEdit ? `${checklistValueText(mark.value)} — ` : ""}{mark.by}, {dateTimeRu(mark.at)}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function NumberMark({ value, onSave }: { value: string | number | undefined; onSave: (value: number | null) => void }) {
  const initial = value == null ? "" : String(value);
  const [text, setText] = useState(initial);
  const clean = text.trim();
  const valid = clean === "" || /^\d{1,7}$/.test(clean);
  const changed = clean !== initial;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} className="h-11 w-32 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900" aria-label="Число" />
      {changed && valid && (
        <button type="button" onClick={() => onSave(clean === "" ? null : Number(clean))} className={button}>
          {clean === "" ? "Снять отметку" : "Сохранить"}
        </button>
      )}
      {!valid && <span className="text-xs text-red-800">целое число от 0</span>}
    </div>
  );
}

/** Заметка: правит закупщик и директор; без телефонов, WeChat и почты (контакты людей не храним). */
export function NoteView({ item, canEdit, onSave }: { item: ShortlistItem; canEdit: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [text, setText] = useState(item.note ?? "");
  if (!canEdit) {
    return item.note ? <p className="whitespace-pre-wrap break-anywhere text-sm leading-6 text-slate-700"><span className="text-slate-500">Заметка:</span> {item.note}</p> : null;
  }
  const changed = text.trim() !== (item.note ?? "");
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-700">
      Заметка (без телефонов, WeChat и почты — контакты людей не храним)
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
      {changed && (
        <button type="button" onClick={() => onSave({ note: text.trim() || null })} className={`${button} self-start`}>
          Сохранить заметку
        </button>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Вопросы фабрике и «Как читать показатели»

/** Готовый текст на китайском с русским переводом — копирует и отправляет человек сам (панель ничего не отправляет). */
export function FactoryQuestions() {
  const { zh, ru } = factoryQuestionsText();
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(zh);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <details className={detailsBox}>
      <summary className={summaryRow}>Вопросы фабрике — текст для переписки</summary>
      <div className="flex flex-col gap-3 pb-3">
        <p className="text-xs leading-5 text-slate-500">Отправляете вы сами — в переписке на 1688; панель ничего не отправляет. Ответы отметьте в чек-листе шорт-листа.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">По-китайски — для отправки</span>
            <pre lang="zh" className="whitespace-pre-wrap break-anywhere rounded-lg bg-slate-50 p-3 font-sans text-sm leading-6 text-slate-900">{zh}</pre>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">По-русски — о чём спрашиваем</span>
            <pre className="whitespace-pre-wrap break-anywhere rounded-lg bg-slate-50 p-3 font-sans text-sm leading-6 text-slate-700">{ru}</pre>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copy} className={button}>
            <ClipboardCopy className="h-4 w-4" /> Скопировать текст по-китайски
          </button>
          {copied === "done" && <span role="status" className="text-sm text-emerald-800">Скопировано</span>}
          {copied === "failed" && <span role="status" className="text-sm text-amber-900">Не скопировалось — выделите текст выше вручную</span>}
        </div>
      </div>
    </details>
  );
}

/** «Как читать показатели» — свёрнуто: метки источников, пороги, оговорки. */
export function FactoryReadingGuide() {
  return (
    <details className={detailsBox}>
      <summary className={summaryRow}>Как читать показатели</summary>
      <ul className="flex list-disc flex-col gap-1 pb-2 pl-5 leading-6">
        {FACTORY_READING_GUIDE.map((line) => <li key={line}>{line}</li>)}
        <li>Чек-лист шорт-листа (Ч) — проверено человеком: лицензия, застрахованные, отчёт проверки, видеозвонок, ответы, образец по пунктам — раздельно, без суммы.</li>
      </ul>
      <div className="pb-3"><SourceLegend /></div>
    </details>
  );
}
