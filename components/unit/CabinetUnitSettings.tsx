"use client";

// Ручные настройки юнит-экономики кабинета: ставка налога и дополнительная
// комиссия (посредник, агент). Ни то, ни другое не приходит из API площадки —
// у каждой компании свой налоговый режим, а комиссия живёт в договоре.
//
// Панель одна на оба маркетплейса: настройки хранятся по кабинету, а кабинеты
// WB и Ozon лежат в одной таблице. Экраны отличаются только оформлением вокруг.

import { Check, Loader2, Percent, Save } from "lucide-react";
import { useEffect, useState } from "react";

export interface AppliedUnitSettings {
  taxPct: number;
  taxSource: "request" | "cabinet" | "default";
  extraCommissionPct: number;
  extraCommissionSource: "request" | "cabinet" | "none";
}

interface Props {
  cabinetId: string | null;
  cabinetName?: string | null;
  canWrite: boolean;
  applied: AppliedUnitSettings | null;
  /** Вызывается после успешного сохранения — экран должен пересчитать цифры. */
  onSaved: () => void;
  tone?: "violet" | "sky";
}

const SOURCE_LABEL: Record<string, string> = {
  cabinet: "настройка кабинета",
  request: "введено на экране",
  default: "по умолчанию",
  none: "не задана",
};

export function CabinetUnitSettings({ cabinetId, cabinetName, canWrite, applied, onSaved, tone = "violet" }: Props) {
  const [tax, setTax] = useState("");
  const [extra, setExtra] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Поля показывают сохранённое значение кабинета, а не то, что применилось к
  // расчёту: иначе значение по умолчанию выглядело бы как введённая настройка.
  useEffect(() => {
    if (!cabinetId) {
      setTax("");
      setExtra("");
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    fetch(`/api/cabinet-settings/unit?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { settings?: Array<{ cabinetId: string; taxPct: number | null; extraCommissionPct: number | null }> }) => {
        if (cancelled) return;
        const found = (body.settings ?? []).find((item) => item.cabinetId === cabinetId);
        setTax(found?.taxPct == null ? "" : String(found.taxPct));
        setExtra(found?.extraCommissionPct == null ? "" : String(found.extraCommissionPct));
      })
      .catch(() => { if (!cancelled) { setTax(""); setExtra(""); } })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [cabinetId]);

  const save = async () => {
    if (!cabinetId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/cabinet-settings/unit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cabinetId,
          taxPct: tax.trim() === "" ? null : tax.trim(),
          extraCommissionPct: extra.trim() === "" ? null : extra.trim(),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
      setSaved(true);
      onSaved();
      window.setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const accent = tone === "sky"
    ? { ring: "focus:border-sky-400 focus:ring-sky-100", button: "bg-sky-600 hover:bg-sky-700", chip: "text-sky-700" }
    : { ring: "focus:border-violet-400 focus:ring-violet-100", button: "bg-violet-600 hover:bg-violet-700", chip: "text-violet-700" };

  if (!cabinetId) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
        Налог и комиссия настраиваются на конкретный кабинет — выберите его, чтобы задать ставки.
      </div>
    );
  }

  const field = (label: string, hint: string, value: string, onChange: (next: string) => void) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <span className="relative">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          inputMode="decimal"
          value={value}
          disabled={!canWrite || !loaded}
          onChange={(event) => onChange(event.target.value)}
          placeholder="—"
          aria-label={label}
          className={`h-11 w-28 rounded-lg border border-slate-200 bg-white pl-2.5 pr-7 text-xs tabular-nums outline-none ring-0 transition focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 sm:h-10 ${accent.ring}`}
        />
        <Percent className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
      </span>
      <span className="text-[10px] text-slate-400">{hint}</span>
    </label>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[150px]">
          <div className="text-[11px] font-semibold text-slate-700">Настройки кабинета</div>
          <div className="mt-0.5 text-[10px] text-slate-400">{cabinetName || "Кабинет"}</div>
        </div>
        {field("Налог", "с цены покупателя", tax, setTax)}
        {field("Комиссия кабинета", "посредник, с цены продавца", extra, setExtra)}
        {canWrite ? (
          <button
            type="button"
            onClick={save}
            disabled={saving || !loaded}
            className={`inline-flex h-11 items-center gap-1.5 self-end rounded-lg px-3 text-[11px] font-semibold text-white shadow-sm transition-colors disabled:cursor-wait disabled:opacity-60 sm:h-10 ${accent.button}`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? "Сохранено" : "Сохранить"}
          </button>
        ) : (
          <span className="self-end pb-2 text-[10px] text-slate-400">Менять ставки может финансовая роль</span>
        )}
        {applied ? (
          <div className="ml-auto flex flex-col items-end gap-0.5 text-[10px] text-slate-500">
            <span>
              В расчёте: налог <b className={accent.chip}>{applied.taxPct}%</b> ({SOURCE_LABEL[applied.taxSource]})
            </span>
            <span>
              Комиссия кабинета <b className={accent.chip}>{applied.extraCommissionPct}%</b> ({SOURCE_LABEL[applied.extraCommissionSource]})
            </span>
          </div>
        ) : null}
      </div>
      {/* Пустое поле — это «не задано»: расчёт вернётся к ставке по умолчанию, а не к нулю. */}
      <p className="mt-2 text-[10px] text-slate-400">
        Пустое поле — настройка не задана: налог берётся по умолчанию, дополнительной комиссии нет.
      </p>
      {error ? <p role="alert" className="mt-2 text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}
