"use client";
/* eslint-disable @next/next/no-img-element -- variant URLs are user-selected WB/external test assets */

import { AlertTriangle, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import type { CtrTestType } from "@/lib/ctrtest/model";
import type { ContentItem } from "@/lib/content/productLibrary";
import type { CtrCandidate, CtrWizardSeed } from "./types";
import { ContentPicker } from "./ContentPicker";

interface VariantDraft { label: string; imageUrl: string; source: string }

interface Props {
  cabinetId: string;
  type: CtrTestType;
  candidates: CtrCandidate[];
  seed?: CtrWizardSeed | null;
  onClose: () => void;
  onCreated: () => void;
}

const typeLabel: Record<CtrTestType, string> = { ctr: "CTR главного фото", cr: "CR фотоворонки", video: "Video proxy" };

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
  return body.data as T;
}

export function CtrTestWizard({ cabinetId, type, candidates, seed, onClose, onCreated }: Props) {
  const initialCandidate = seed?.candidate ?? null;
  const [nmId, setNmId] = useState(initialCandidate?.nm ?? 0);
  const [intervalMin, setIntervalMin] = useState(60);
  const [impressionsPerRound, setImpressionsPerRound] = useState(350);
  const [targetImpressions, setTargetImpressions] = useState(1000);
  const [spendCapRub, setSpendCapRub] = useState(5000);
  const [variants, setVariants] = useState<VariantDraft[]>(() => {
    if (seed?.baseline?.imageUrl) return [
      { label: `Победитель теста #${seed.sourceTestId}`, imageUrl: seed.baseline.imageUrl, source: "winner" },
      { label: "Новый вариант", imageUrl: "", source: "link" },
    ];
    if (initialCandidate) return [
      { label: type === "video" ? "Текущее видео" : "Текущее фото", imageUrl: type === "video" ? "" : wbCardImageUrl(initialCandidate.nm, "big"), source: "current" },
      { label: "Вариант B", imageUrl: "", source: "link" },
    ];
    return [{ label: type === "video" ? "Текущее видео" : "Текущее фото", imageUrl: "", source: "current" }, { label: "Вариант B", imageUrl: "", source: "link" }];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidateOptions = useMemo(() => initialCandidate && !candidates.some((candidate) => candidate.nm === initialCandidate.nm) ? [initialCandidate, ...candidates] : candidates, [candidates, initialCandidate]);
  const selected = useMemo(() => candidateOptions.find((candidate) => candidate.nm === nmId) ?? initialCandidate, [candidateOptions, initialCandidate, nmId]);

  const pickCandidate = (nextNm: number) => {
    setNmId(nextNm);
    const candidate = candidates.find((item) => item.nm === nextNm);
    if (!candidate || seed?.baseline) return;
    setVariants((current) => current.map((variant, index) => index === 0 ? { ...variant, imageUrl: type === "video" ? "" : wbCardImageUrl(candidate.nm, "big"), source: "current", label: type === "video" ? "Текущее видео" : "Текущее фото" } : variant));
  };

  const setVariant = (index: number, field: "label" | "imageUrl", value: string) => {
    setVariants((current) => current.map((variant, position) => position === index ? { ...variant, [field]: value } : variant));
  };

  /**
   * Клик по кадру библиотеки.
   *
   * Первым делом заполняется пустой вариант — их в мастере изначально два, и
   * человек, ткнувший в две картинки, ожидает получить тест из них двух, а не
   * тест из одной и пустую рамку. Свободных нет — добавляем новый, пока не
   * упрёмся в шесть: столько же принимает форма ниже.
   *
   * Повторный клик по выбранному снимает выбор. Без этого промах исправлялся
   * бы только через поле со ссылкой, то есть ровно тем способом, от которого
   * библиотека и избавляет.
   */
  const pickFromLibrary = (item: ContentItem) => {
    setVariants((current) => {
      const already = current.findIndex((variant) => variant.imageUrl === item.url);
      if (already >= 0) {
        // Первый вариант — базовый, его не удаляем: тест без базы бессмыслен.
        if (already === 0) return current.map((variant, index) => index === 0 ? { ...variant, imageUrl: "" } : variant);
        return current.length > 2
          ? current.filter((_, index) => index !== already)
          : current.map((variant, index) => index === already ? { ...variant, imageUrl: "" } : variant);
      }
      const free = current.findIndex((variant) => !variant.imageUrl.trim());
      if (free >= 0) {
        return current.map((variant, index) => index === free
          ? { ...variant, imageUrl: item.url, source: item.origin === "card" ? "current" : "library", label: variant.label }
          : variant);
      }
      if (current.length >= 6) return current;
      return [...current, {
        label: `Вариант ${String.fromCharCode(65 + current.length)}`,
        imageUrl: item.url,
        source: item.origin === "card" ? "current" : "library",
      }];
    });
  };

  const create = async () => {
    if (!selected) { setError("Выберите товар из данных этого кабинета"); return; }
    setBusy(true); setError(null);
    try {
      await responseJson(await fetch("/api/ctrtest/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cabinetId,
          nmId: selected.nm,
          article: selected.art,
          name: selected.art,
          testType: type,
          intervalMin,
          impressionsPerRound,
          targetImpressions,
          spendCapRub,
          sourceTestId: seed?.sourceTestId ?? null,
          variants: variants.map((variant, index) => ({ ...variant, isBaseline: index === 0 })),
        }),
      }));
      onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать тест"); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="ctr-wizard-title" className="rounded-xl border border-violet-200 bg-white p-4 shadow-[0_10px_30px_rgba(76,29,149,0.08)]">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700"><ImagePlus className="h-4 w-4" /></div>
        <div><h2 id="ctr-wizard-title" className="text-sm font-bold text-slate-900">Новый тест · {typeLabel[type]}</h2><p className="mt-1 text-[11px] text-slate-500">Черновик не меняет карточку WB. Каждый раунд запускается только после ручного подтверждения установленного контента.</p></div>
        <button type="button" onClick={onClose} aria-label="Закрыть мастер" className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Товар
          <select value={nmId || ""} onChange={(event) => pickCandidate(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400">
            <option value="">Выберите артикул / nm</option>
            {candidateOptions.map((candidate) => <option key={candidate.nm} value={candidate.nm}>{candidate.art} · nm {candidate.nm} · CTR {candidate.ctr ?? "—"}%</option>)}
          </select>
        </label>
        <label className="text-[11px] font-medium text-slate-600">Показов на вариант<input type="number" min={100} step={100} value={targetImpressions} onChange={(event) => setTargetImpressions(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400" /></label>
        <label className="text-[11px] font-medium text-slate-600">Показов за раунд<input type="number" min={10} step={10} value={impressionsPerRound} onChange={(event) => setImpressionsPerRound(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400" /></label>
        <label className="text-[11px] font-medium text-slate-600">Интервал, минут<input type="number" min={5} step={5} value={intervalMin} onChange={(event) => setIntervalMin(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400" /></label>
        <label className="text-[11px] font-medium text-slate-600">Лимит расходов, ₽<input type="number" min={100} step={100} value={spendCapRub} onChange={(event) => setSpendCapRub(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400" /></label>
      </div>

      {/*
        Библиотека стоит НАД полями вариантов, а не под ними: выбрать из своего
        контента — обычный путь, вставить ссылку руками — исключение. Порядок на
        экране должен повторять этот порядок, иначе поле со ссылкой снова
        читается как единственный способ.
      */}
      <div className="mt-4">
        <ContentPicker
          cabinetId={cabinetId}
          nmId={selected?.nm ?? 0}
          testType={type}
          selectedUrls={variants.map((variant) => variant.imageUrl)}
          onPick={pickFromLibrary}
        />
      </div>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {variants.map((variant, index) => <div key={index} className="w-[220px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[10px] font-bold text-violet-700 shadow-sm">{String.fromCharCode(65 + index)}</span><input value={variant.label} onChange={(event) => setVariant(index, "label", event.target.value)} aria-label={`Название варианта ${index + 1}`} className="min-h-11 min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none" />{index > 1 ? <button type="button" onClick={() => setVariants((current) => current.filter((_, position) => position !== index))} aria-label={`Удалить вариант ${index + 1}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>
          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-white">{variant.imageUrl ? type === "video" ? <video src={variant.imageUrl} controls muted preload="metadata" className="h-full w-full object-cover" /> : <img src={variant.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[10px] text-slate-300">HTTPS-ссылка на контент</div>}</div>
          <input type="url" value={variant.imageUrl} onChange={(event) => setVariant(index, "imageUrl", event.target.value)} placeholder="https://…" aria-label={`Ссылка варианта ${index + 1}`} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] outline-none focus:border-violet-400" />
          {index === 0 ? <div className="mt-2 text-[9px] font-medium text-violet-600">Базовый вариант</div> : null}
        </div>)}
        {variants.length < 6 ? <button type="button" onClick={() => setVariants((current) => [...current, { label: `Вариант ${String.fromCharCode(65 + current.length)}`, imageUrl: "", source: "link" }])} className="grid min-h-[270px] w-[180px] shrink-0 place-items-center rounded-xl border-2 border-dashed border-violet-200 text-xs font-semibold text-violet-600 hover:bg-violet-50"><span className="flex flex-col items-center gap-2"><Plus className="h-6 w-6" />Добавить вариант</span></button> : null}
      </div>

      {type === "video" ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />WB API не возвращает просмотры конкретного видео. Победитель рассчитывается по честному proxy: заказы / открытия карточки за слот.</div> : null}
      {error ? <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}
      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-600">Отмена</button><button type="button" onClick={() => void create()} disabled={busy || !selected || variants.some((variant) => !variant.imageUrl.trim())} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}Создать тест (черновик)</button></div>
    </section>
  );
}
