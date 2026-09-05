"use client";
/* eslint-disable @next/next/no-img-element -- превью библиотеки: адреса приходят из WB-баскета и нашего бакета */

import { Check, ImageOff, Loader2, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { USABILITY_HINT, USABILITY_LABEL } from "@/lib/content/assetUsability";
import { itemsForTestType, type ContentItem, type ProductContent } from "@/lib/content/productLibrary";
import type { CtrTestType } from "@/lib/ctrtest/model";

/**
 * Выбор вариантов теста из того, что у товара уже есть.
 *
 * До сих пор мастер требовал вставить HTTPS-ссылку руками на каждый вариант,
 * кроме первого: библиотеки, из которой выбрать, в панели не было вовсе. При
 * этом контент был — 9 069 файлов в каталоге съёмок, который в этом
 * репозитории не читал никто, и галерея карточки, которую обход приносил и
 * выбрасывал.
 *
 * Кликом добавляется только то, что WB сможет скачать. Остальное показано, но
 * не выбирается и говорит почему: спрятать недоступный кадр значило бы
 * оставить человека гадать, куда делась его съёмка, а пустить его в тест —
 * получить тест, который не запустится, и виноватой будет выглядеть панель.
 */

interface LibraryResponse {
  products: ProductContent[];
  galleryColumnsMissing?: boolean;
  migrationHint?: string | null;
}

export function ContentPicker({
  cabinetId,
  nmId,
  testType,
  selectedUrls,
  onPick,
}: {
  cabinetId: string;
  /** Товар, ради которого открыт мастер. 0 — товар ещё не выбран. */
  nmId: number;
  /** Тип теста решает, какие кадры вообще имеют смысл вариантами. */
  testType: CtrTestType;
  selectedUrls: string[];
  onPick: (item: ContentItem) => void;
}) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!cabinetId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/content/library?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as (LibraryResponse & { error?: string }) | null;
        if (!response.ok || !body || body.error) throw new Error(body?.error || `Библиотека не ответила (${response.status})`);
        return body;
      })
      .then((body) => setData(body))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить библиотеку");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId]);

  const product = useMemo(
    () => data?.products.find((item) => item.nmId === nmId) ?? null,
    [data, nmId],
  );

  // Пока товар не выбран — показываем всё, что есть в кабинете: человек пришёл
  // «посмотреть контент по товарам», и пустой экран до выбора артикула был бы
  // ответом не на тот вопрос.
  const items = useMemo(() => {
    if (product) return itemsForTestType(product.items, testType);
    if (!showAll || !data) return [];
    // В общем списке подпись начинается с артикула — иначе непонятно, чей это
    // кадр. Но имена файлов каталога уже часто начинаются с него же, и без
    // проверки выходило «HT-80-11 · HT-80-11 · фото 1».
    return data.products.flatMap((entry) => itemsForTestType(entry.items, testType).map((item) => ({
      ...item,
      label: item.label.startsWith(entry.article) ? item.label : `${entry.article} · ${item.label}`,
    })));
  }, [data, product, showAll, testType]);

  const selected = useMemo(() => new Set(selectedUrls.filter(Boolean)), [selectedUrls]);

  if (loading) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[11px] text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        Читаем библиотеку контента
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{error}</div>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-bold text-slate-700">Контент товара</h3>
        <span className="text-[10px] text-slate-400">
          {product
            ? `${items.filter((item) => item.usability === "public").length} из ${items.length} можно отдать в тест`
            : "Выберите товар выше — или посмотрите весь контент кабинета"}
        </span>
        {/*
          Почему список короче, чем весь контент товара. Без этой строки
          человек, знающий, что у карточки 27 кадров, решит, что панель их
          потеряла.
        */}
        {testType === "ctr" && product ? (
          <span
            title="CTR решает обложка: остальные кадры карточки человек видит уже после клика — они влияют на конверсию, а не на кликабельность."
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500"
          >
            только обложка и кандидаты в неё
          </span>
        ) : null}
        {!product && data?.products.length ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="ml-auto min-h-8 rounded-lg bg-slate-100 px-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
          >
            {showAll ? "Свернуть" : "Показать весь контент кабинета"}
          </button>
        ) : null}
      </div>

      {/*
        Галерея карточек лежит за миграцией, которую применяет владелец. Пока её
        нет, в библиотеке только съёмки — и сказать об этом надо, иначе человек
        решит, что фото его карточек потерялись.
      */}
      {data?.galleryColumnsMissing ? (
        <p className="mt-2 rounded-lg bg-sky-50 px-2 py-1.5 text-[10px] leading-4 text-sky-900">
          {data.migrationHint}. Пока показаны только файлы каталога съёмок.
        </p>
      ) : null}

      {product?.galleryUnknown && !data?.galleryColumnsMissing ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-500">
          Карточка ещё не обойдена после включения галереи — её кадры появятся после ближайшего обхода.
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-400">
          {product ? "По этому товару в библиотеке пока ничего нет — вставьте ссылку вручную ниже." : "Нажмите «Показать весь контент кабинета»."}
        </p>
      ) : (
        <div className="mt-3 grid max-h-[320px] grid-cols-3 gap-2 overflow-auto sm:grid-cols-5 lg:grid-cols-7">
          {items.map((item) => {
            const publishable = item.usability === "public";
            const isSelected = selected.has(item.url);
            return (
              <button
                key={item.key}
                type="button"
                disabled={!publishable}
                onClick={() => onPick(item)}
                title={`${item.label} — ${USABILITY_LABEL[item.usability]}. ${USABILITY_HINT[item.usability]}`}
                aria-pressed={isSelected}
                className={`group relative aspect-[3/4] overflow-hidden rounded-lg border text-left transition ${
                  isSelected ? "border-violet-500 ring-2 ring-violet-200" : "border-slate-200"
                } ${publishable ? "cursor-pointer hover:border-violet-400" : "cursor-not-allowed opacity-45"}`}
              >
                {item.usability === "unresolved" || item.usability === "missing" ? (
                  <span className="grid h-full w-full place-items-center bg-slate-50 text-slate-300">
                    <ImageOff className="h-5 w-5" aria-hidden="true" />
                  </span>
                ) : item.kind === "video" ? (
                  <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <img src={item.thumbUrl} alt={item.label} loading="lazy" className="h-full w-full object-cover" />
                )}

                {item.isCover ? (
                  <span className="absolute left-1 top-1 rounded bg-slate-900/80 px-1 py-0.5 text-[8px] font-bold text-white">обложка</span>
                ) : null}
                {!publishable ? (
                  <span className="absolute left-1 top-1 grid h-4 w-4 place-items-center rounded bg-slate-900/70 text-white">
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                  </span>
                ) : null}
                {isSelected ? (
                  <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-violet-600 text-white">
                    <Check className="h-2.5 w-2.5" aria-hidden="true" />
                  </span>
                ) : null}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-slate-900/80 to-transparent px-1 py-0.5 text-[8px] text-white">
                  {publishable ? item.label : USABILITY_LABEL[item.usability]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
