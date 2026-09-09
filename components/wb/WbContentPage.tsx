"use client";
/* eslint-disable @next/next/no-img-element -- превью каталога: адреса приходят из WB-баскета и нашего публичного бакета */

import { Images, Loader2, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { isPanelOwned, USABILITY_HINT, USABILITY_LABEL } from "@/lib/content/assetUsability";
import { displayableItems, type ContentItem, type ProductContent } from "@/lib/content/productLibrary";
import { plural } from "@/lib/warehouse/plural";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

/**
 * Каталог контента кабинета — весь, а не по одному товару.
 *
 * До сих пор библиотека была доступна ровно из одного места: подборщика внутри
 * мастера CTR-теста. То есть посмотреть, что вообще снято по товару, можно было
 * только начав заводить тест, и только по одному артикулу за раз. Экрана,
 * который показывает съёмки как склад — со списком, поиском и счётчиками, — не
 * существовало, хотя данных в каталоге девять тысяч строк.
 *
 * Недоступное на диске сюда не попадает: правило одно с подборщиком
 * (`displayableItems`), и оно сознательно не «прячет проблему» — сколько файлов
 * не показано, написано числом в шапке. Пустая серая плитка с замком не
 * сообщает ничего, а вот «скрыто 2 577» — сообщает.
 *
 * Каталог здесь редактируемый: файл можно добавить и убрать, не заходя в мастер
 * теста. Роут и правила те же, что у подборщика (`/api/content/upload`), в том
 * числе главное: удалять можно только то, что положила сама панель. Кадр
 * карточки живёт в WB, съёмка — в каталоге завода; корзина на них означала бы
 * обещание, которого панель не может сдержать.
 */

interface LibraryResponse {
  products: ProductContent[];
  galleryColumnsMissing?: boolean;
  migrationHint?: string | null;
  attachedAssets?: number;
  totalAssets?: number | null;
  orphanAssets?: number | null;
  error?: string;
}

/** Сколько плиток товара показываем до нажатия «показать все». */
const PREVIEW_TILES = 12;
/** Сколько товаров рисуем сразу: экран открывается ради поиска, а не ради скролла. */
const PRODUCTS_STEP = 24;

type Usable = "public" | "panel-only";

const FILTERS: { value: Usable; label: string }[] = [
  { value: "public", label: "годны в тест" },
  { value: "panel-only", label: "только просмотр" },
];

function Tile({ item, busy, onRemove }: { item: ContentItem; busy: boolean; onRemove: (item: ContentItem) => void }) {
  const publishable = item.usability === "public";
  const title = `${item.label} — ${USABILITY_LABEL[item.usability]}. ${USABILITY_HINT[item.usability]}`;
  // Корзина — СОСЕДОМ ссылки, а не внутри неё: кнопка внутри ссылки
  // недопустима, и клик по корзине не должен заодно открывать файл.
  return (
    <div className="group relative">
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="group relative block aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition hover:border-violet-400"
    >
      {item.kind === "video" ? (
        <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <img src={item.thumbUrl} alt={item.label} loading="lazy" className="h-full w-full object-cover" />
      )}
      {item.isCover ? (
        <span className="absolute left-1 top-1 rounded bg-slate-900/80 px-1 py-0.5 text-[8px] font-bold text-white">обложка</span>
      ) : null}
      {!publishable ? (
        <span className="absolute right-1 top-1 rounded bg-amber-500/90 px-1 py-0.5 text-[8px] font-bold text-white">
          только просмотр
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-slate-900/85 to-transparent px-1 py-0.5 text-[8px] text-white">
        {item.label}
      </span>
    </a>
    {isPanelOwned(item.url) ? (
      <button
        type="button"
        onClick={() => onRemove(item)}
        disabled={busy}
        title="Убрать из библиотеки и удалить файл"
        className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded bg-slate-900/70 text-white opacity-0 transition hover:bg-rose-600 focus-visible:opacity-100 disabled:opacity-40 group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" aria-hidden="true" />
      </button>
    ) : null}
    </div>
  );
}

function ProductCard({
  product,
  filters,
  cabinetId,
  onChanged,
}: {
  product: ProductContent;
  filters: Set<Usable>;
  cabinetId: string;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Своё фото прямо в каталог.
   *
   * Файл уезжает в публичный бакет и тут же дописывается в `content_assets`
   * с артикулом этого товара — то есть появляется здесь же уже пригодным к
   * тесту. Роут один с подборщиком: две двери в один каталог не должны
   * складывать файлы по-разному.
   */
  const upload = async (file: File) => {
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("cabinet", cabinetId);
      form.set("nmId", String(product.nmId));
      form.set("article", product.article);
      const response = await fetch("/api/content/upload", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не удалось загрузить (${response.status})`);
      setNotice(`Загружено: ${file.name}`);
      onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось загрузить файл");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (item: ContentItem) => {
    // Удаление необратимо: файл уходит и из каталога, и из хранилища.
    if (!window.confirm(`Убрать «${item.label}» из библиотеки? Файл удалится из хранилища насовсем.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const query = new URLSearchParams({ url: item.url, cabinet: cabinetId });
      const response = await fetch(`/api/content/upload?${query}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не удалось удалить (${response.status})`);
      setNotice(body?.note ?? "Файл убран из библиотеки.");
      onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось удалить файл");
    } finally {
      setBusy(false);
    }
  };

  // Скрытое считаем ДО фильтров: «скрыто N» должно означать «недоступно на
  // диске», а не «вы сняли галочку». Иначе число врёт при каждом клике.
  const shown = useMemo(() => displayableItems(product.items), [product.items]);
  const hiddenOnDisk = product.items.length - shown.length;
  const visible = useMemo(
    () => shown.filter((item) => filters.has(item.usability as Usable)),
    [shown, filters],
  );

  const tiles = expanded ? visible : visible.slice(0, PREVIEW_TILES);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-[13px] font-bold tracking-[-0.01em] text-slate-800">{product.article}</h2>
        <span className="text-[10px] text-slate-400">nm {product.nmId}</span>
        {product.name ? <span className="min-w-0 truncate text-[11px] text-slate-500">{product.name}</span> : null}
        <span className="ml-auto text-[10px] text-slate-400">
          {product.publishableCount} из {shown.length} годны в тест
          {hiddenOnDisk > 0 ? ` · скрыто ${hiddenOnDisk}` : ""}
        </span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex h-6 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[10px] font-medium text-slate-600 transition hover:border-violet-400 hover:text-violet-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-3 w-3" aria-hidden="true" />}
          Добавить фото
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>

      {notice ? <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[10px] leading-4 text-slate-600">{notice}</p> : null}

      {product.galleryUnknown ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-500">
          Карточка ещё не обойдена после включения галереи — её кадры появятся после ближайшего обхода.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-2 text-[11px] text-slate-400">
          {shown.length === 0
            ? "По этому товару в каталоге пока ничего нет."
            : "Под выбранные фильтры ничего не подошло."}
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12">
            {tiles.map((item) => <Tile key={item.key} item={item} busy={busy} onRemove={(entry) => void remove(entry)} />)}
          </div>
          {visible.length > PREVIEW_TILES ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-2 text-[11px] font-medium text-violet-600 hover:text-violet-700"
            >
              {expanded ? "свернуть" : `показать все ${visible.length}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

export function WbContentPage() {
  const { cabinetId, ready, hasExactCabinet } = useWbCabinet();
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<Usable>>(() => new Set<Usable>(["public", "panel-only"]));
  const [limit, setLimit] = useState(PRODUCTS_STEP);
  // Счётчик перечитывания: после загрузки и удаления сетка обязана показать
  // то, что реально лежит в каталоге, а не то, что было до действия.
  const [reloadKey, setReloadKey] = useState(0);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!ready || !cabinetId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/content/library?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as LibraryResponse | null;
        if (!response.ok || !body || body.error) throw new Error(body?.error || `Каталог не ответил (${response.status})`);
        return body;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить каталог");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, ready, reloadKey]);

  // Через useMemo, а не `data?.products ?? []`: пустой литерал был бы новой
  // ссылкой на каждый рендер и пересчитывал бы всё, что от него зависит.
  const products = useMemo(() => data?.products ?? [], [data]);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? products.filter((product) => `${product.article} ${product.name} ${product.subject} ${product.nmId}`.toLowerCase().includes(needle))
      : products;
    // Сверху то, где есть что смотреть: товар без единого доступного файла —
    // это не то, ради чего человек открыл каталог.
    return [...list].sort((left, right) => right.publishableCount - left.publishableCount || left.article.localeCompare(right.article, "ru"));
  }, [products, query]);

  // Считаем по НАЙДЕННЫМ товарам, а не по всем: иначе шапка говорила
  // «4 053 файла по 8 товарам» — число файлов от всего кабинета, число товаров
  // от поиска. Две правды в одной строке читаются как одна и врут.
  const totals = useMemo(() => {
    let all = 0;
    let shown = 0;
    for (const product of found) {
      all += product.items.length;
      shown += displayableItems(product.items).length;
    }
    return { all, shown, hidden: all - shown };
  }, [found]);

  useEffect(() => { setLimit(PRODUCTS_STEP); }, [query]);

  const toggle = (value: Usable) => setFilters((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f9]">
      <WbModuleHeader
        icon={Images}
        title="Контент"
        description={
          loading
            ? "читаем каталог…"
            : `${totals.shown.toLocaleString("ru-RU")} ${plural(totals.shown, "файл", "файла", "файлов")} по ${found.length} ${plural(found.length, "товару", "товарам", "товарам")}` +
              (totals.hidden > 0 ? ` · скрыто ${totals.hidden.toLocaleString("ru-RU")} — файл лежит на Яндекс.Диске, ссылки на него нет` : "")
        }
        actions={
          <>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="артикул, название, nm"
                className="h-8 w-56 rounded-lg border border-slate-200 bg-white pl-7 pr-2 text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-400"
              />
            </label>
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => toggle(filter.value)}
                aria-pressed={filters.has(filter.value)}
                className={`h-8 rounded-lg border px-2.5 text-[11px] font-medium transition ${
                  filters.has(filter.value)
                    ? "border-violet-500 bg-violet-600 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </>
        }
      />

      <div className="flex-1 space-y-2.5 px-3 py-3 sm:px-6">
        {!ready ? null : !hasExactCabinet ? (
          <WbEmptyState>Выберите один реальный WB-кабинет — каталог собирается по его товарам.</WbEmptyState>
        ) : error ? (
          <WbErrorState message={error} />
        ) : loading && !data ? (
          // Баннер во весь экран — только на ПЕРВОЙ загрузке. После добавления
          // или удаления файла список перечитывается, и подменять его на
          // «готовим данные» значило бы на каждый клик убирать с глаз то, ради
          // чего человек сюда пришёл.
          <LoadingBanner seconds={elapsed} hint="каталог контента" />
        ) : data?.galleryColumnsMissing ? (
          <WbEmptyState>{data.migrationHint ?? "Галерея карточек ещё не включена."}</WbEmptyState>
        ) : found.length === 0 ? (
          <WbEmptyState>
            {query ? "По запросу ничего не нашлось." : "В этом кабинете пока нет товаров с контентом."}
          </WbEmptyState>
        ) : (
          <>
            {found.slice(0, limit).map((product) => (
              <ProductCard
                key={product.nmId}
                product={product}
                filters={filters}
                cabinetId={cabinetId}
                onChanged={() => setReloadKey((value) => value + 1)}
              />
            ))}
            {found.length > limit ? (
              <button
                type="button"
                onClick={() => setLimit((value) => value + PRODUCTS_STEP)}
                className="mx-auto flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-[12px] font-medium text-slate-600 hover:border-slate-300"
              >
                <Loader2 className="h-3.5 w-3.5" aria-hidden="true" />
                Показать ещё {Math.min(PRODUCTS_STEP, found.length - limit)} из {found.length - limit}
              </button>
            ) : null}
            {/*
              Файлы каталога, не приросшие ни к одному товару этого кабинета.
              Их не показать сеткой — товара у них нет, — но и промолчать про
              них нельзя: это чья-то работа, которая сейчас недоступна.
            */}
            {typeof data?.orphanAssets === "number" && data.orphanAssets > 0 ? (
              <p className="px-1 pb-2 pt-1 text-[11px] text-slate-400">
                Ещё {data.orphanAssets.toLocaleString("ru-RU")} {plural(data.orphanAssets, "файл", "файла", "файлов")} каталога
                не привязаны ни к одному товару — у них не заполнен артикул, поэтому показать их рядом с товаром нечем.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
