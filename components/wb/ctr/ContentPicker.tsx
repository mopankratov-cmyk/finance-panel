"use client";
/* eslint-disable @next/next/no-img-element -- превью библиотеки: адреса приходят из WB-баскета и нашего бакета */

import { Check, ImageOff, Loader2, Lock, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isPanelUpload, USABILITY_HINT, USABILITY_LABEL } from "@/lib/content/assetUsability";
import { plural } from "@/lib/warehouse/plural";
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
  // Счётчик перечитывания библиотеки: после загрузки и удаления сетка обязана
  // показать то, что реально лежит в каталоге, а не то, что было до действия.
  const [reloadKey, setReloadKey] = useState(0);
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
  }, [cabinetId, reloadKey]);

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

  /**
   * Сетка показывает только то, что видно глазом.
   *
   * У записей каталога со статусами «файл недоступен» и «нет ссылки» нечего
   * рисовать: в галерее они выглядели пустыми плитками с замком — целый ряд
   * серых прямоугольников, который ничего не сообщает и не нажимается.
   * Считаем их и говорим числом, а место не занимаем.
   */
  const shown = useMemo(() => items.filter((item) => item.usability !== "unresolved" && item.usability !== "missing"), [items]);
  const hidden = items.length - shown.length;

  const selected = useMemo(() => new Set(selectedUrls.filter(Boolean)), [selectedUrls]);

  /**
   * Своё фото прямо отсюда.
   *
   * Раньше кадр, снятый вчера, попадал в тест только через выкладывание
   * куда-то наружу: вариант скачивает сам WB, и относительная ссылка ему не
   * годится. Панель кладёт файл в публичное хранилище и сразу дописывает в
   * каталог — он появляется в этой же сетке уже пригодным к тесту.
   */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!product) return;
    setBusy("upload");
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
      setReloadKey((value) => value + 1);
      setNotice(`Загружено: ${file.name}. Файл уже можно отдать в тест.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось загрузить файл");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (item: ContentItem) => {
    if (!window.confirm(`Убрать «${item.label}» из библиотеки? Файл удалится из хранилища насовсем.`)) return;
    setBusy(item.key);
    setNotice(null);
    try {
      const query = new URLSearchParams({ url: item.url, cabinet: cabinetId });
      const response = await fetch(`/api/content/upload?${query}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не удалось удалить (${response.status})`);
      setReloadKey((value) => value + 1);
      setNotice(body?.note ?? "Файл убран из библиотеки.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось удалить файл");
    } finally {
      setBusy(null);
    }
  };

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
        {product ? (
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              title="JPEG, PNG или WebP до 12 МБ. Файл попадёт в библиотеку этого артикула и сразу станет пригоден для теста."
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 text-[10px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
            >
              <Upload className="h-3 w-3" aria-hidden="true" />
              {busy === "upload" ? "Загружаю…" : "Загрузить фото"}
            </button>
          </div>
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

      {notice ? (
        <p role="status" className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-600">
          {notice}
        </p>
      ) : null}

      {hidden > 0 ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-500">
          Ещё {hidden} {plural(hidden, "файл", "файла", "файлов")} каталога не показываю: в записи путь на Яндекс.Диске
          вместо адреса, открыть нечем. Чтобы такой кадр стал доступен, его нужно переложить в наше хранилище —
          или загрузите нужное фото кнопкой ниже.
        </p>
      ) : null}

      {product?.galleryUnknown && !data?.galleryColumnsMissing ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-500">
          Карточка ещё не обойдена после включения галереи — её кадры появятся после ближайшего обхода.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-400">
          {product ? "По этому товару в библиотеке пока ничего нет — вставьте ссылку вручную ниже." : "Нажмите «Показать весь контент кабинета»."}
        </p>
      ) : (
        <div className="mt-3 grid max-h-[320px] grid-cols-3 gap-2 overflow-auto sm:grid-cols-5 lg:grid-cols-7">
          {shown.map((item) => {
            const publishable = item.usability === "public";
            const isSelected = selected.has(item.url);
            return (
              <div key={item.key} className="group relative">
              <button
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
              {/*
                Удаление рядом с плиткой, а не внутри неё: кнопка внутри кнопки
                недопустима, а клик по корзине не должен заодно выбирать вариант.
                Показываем только на своих загрузках — кадр карточки живёт в WB,
                съёмка в каталоге завода, и панель ими не распоряжается.
              */}
              {isPanelUpload(item.url) ? (
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  disabled={busy !== null}
                  title="Убрать из библиотеки и удалить файл"
                  aria-label={`Удалить ${item.label}`}
                  className="absolute right-1 bottom-1 grid h-5 w-5 place-items-center rounded bg-slate-900/70 text-white opacity-0 transition-opacity hover:bg-red-600 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
