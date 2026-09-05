"use client";

import { useEffect, useState } from "react";
import { Loader2, Coins, Plus, Check, Search, TriangleAlert } from "lucide-react";
import { ActionableError } from "@/components/ui/ActionableError";

interface Row {
  article: string;
  name: string;
  cost_rub: number;
  /** Фулфилмент на единицу: приёмка, упаковка, маркировка, отгрузка. */
  fulfillment_rub: number;
  brand: string;
  category: string;
  source: string;
  inherited_from: string | null;
}

/** Что можно послать на сохранение. Пустой патч не отправляется вовсе. */
interface CostPatch {
  cost_rub?: number;
  fulfillment_rub?: number;
  name?: string;
  category?: string;
}

const rub = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CostsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [ffEdits, setFfEdits] = useState<Record<string, string>>({});
  const [catEdits, setCatEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [newArt, setNewArt] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newFf, setNewFf] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/costs", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `Ошибка ${r.status}`);
      setRows(j.rows ?? []);
      setWarnings(Array.isArray(j.warnings) ? j.warnings : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить себестоимость");
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const knownCategories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));

  const save = async (article: string, patch: CostPatch) => {
    if (!Object.keys(patch).length) return;
    setSaving(article);
    setSaveError("");
    try {
      const r = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article, ...patch }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Ошибка ${r.status}`);
      setRows((rs) => {
        const existing = rs.find((x) => x.article === article);
        if (existing) {
          if (patch.cost_rub !== undefined) existing.cost_rub = patch.cost_rub;
          if (patch.fulfillment_rub !== undefined) existing.fulfillment_rub = patch.fulfillment_rub;
          if (patch.category !== undefined) existing.category = patch.category;
          return [...rs];
        }
        return [{
          article,
          name: patch.name || article,
          cost_rub: patch.cost_rub ?? 0,
          fulfillment_rub: patch.fulfillment_rub ?? 0,
          brand: "",
          category: patch.category || "",
          source: "Справочник",
          inherited_from: null,
        }, ...rs];
      });
      setSavedAt((s) => ({ ...s, [article]: Date.now() }));
      setEdits((e) => { const c = { ...e }; delete c[article]; return c; });
      setFfEdits((e) => { const c = { ...e }; delete c[article]; return c; });
      setCatEdits((e) => { const c = { ...e }; delete c[article]; return c; });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Не удалось сохранить себестоимость");
    }
    setSaving(null);
  };

  /**
   * Патч строки — ТОЛЬКО изменённые поля. Отправлять всё подряд нельзя:
   * тогда правка фулфилмента переписывала бы и себестоимость, а пустое поле
   * молча превращало бы её в ноль.
   */
  const rowPatch = (r: Row): CostPatch => {
    const patch: CostPatch = {};
    const cost = edits[r.article];
    const ff = ffEdits[r.article];
    const category = catEdits[r.article];
    if (cost != null && cost !== String(r.cost_rub || "")) patch.cost_rub = Number(cost) || 0;
    if (ff != null && ff !== String(r.fulfillment_rub || "")) patch.fulfillment_rub = Number(ff) || 0;
    if (category != null && category !== (r.category ?? "")) patch.category = category;
    return patch;
  };

  const flt = rows.filter((r) => { const s = q.toLowerCase().trim(); return !s || r.article.toLowerCase().includes(s) || r.name.toLowerCase().includes(s); });
  const filled = rows.filter((r) => r.cost_rub > 0).length;
  const missing = Math.max(0, rows.length - filled);
  const fillPct = rows.length ? Math.round((filled / rows.length) * 100) : 0;
  const ffFilled = rows.filter((r) => r.fulfillment_rub > 0).length;

  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-0 w-full max-w-none space-y-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Coins className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900">Себестоимость</h1>
              <p className="text-sm text-slate-500">
                Себес и фулфилмент по артикулам — вместе питают маржу WB, Ozon, ОПиУ
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm lg:min-w-[520px] lg:grid-cols-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Всего SKU</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{loading ? "—" : rows.length}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">Себес</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-700">{loading ? "—" : `${filled}/${rows.length}`}</div>
            </div>
            {/* Фулфилмент считаем отдельно: он уходит в маржу наравне с себесом,
                и его пробел так же тихо завышает прибыль. */}
            <div className="rounded-xl bg-sky-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-sky-600">Фулфилмент</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-sky-700">{loading ? "—" : `${ffFilled}/${rows.length}`}</div>
            </div>
            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-amber-600">Покрытие</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-amber-700">{loading ? "—" : `${fillPct}%`}</div>
            </div>
          </div>
        </div>

        {/* добавить */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_150px_150px_150px]">
            <input
              value={newArt}
              onChange={(e) => setNewArt(e.target.value)}
              placeholder="Артикул или offer_id"
              aria-label="Артикул или offer_id"
              className="min-h-11 min-w-0 rounded-xl border border-slate-300 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <input
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              placeholder="Себес ₽"
              aria-label="Себестоимость в рублях"
              type="number"
              min="0"
              className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <input
              value={newFf}
              onChange={(e) => setNewFf(e.target.value)}
              placeholder="Фулфилмент ₽"
              aria-label="Фулфилмент в рублях"
              type="number"
              min="0"
              className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <button
              onClick={() => {
                if (!newArt.trim()) return;
                save(newArt.trim(), { cost_rub: Number(newCost) || 0, fulfillment_rub: Number(newFf) || 0 });
                setNewArt(""); setNewCost(""); setNewFf("");
              }}
              disabled={!newArt.trim()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Добавить
            </button>
          </div>
        </div>

        {error ? <ActionableError message={error} label="Себестоимость" onRetry={load} /> : null}
        {saveError ? <ActionableError message={saveError} label="Сохранение себестоимости" compact tone="amber" /> : null}
        {warnings.length ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <div className="font-semibold">Не весь каталог удалось сверить</div>
              <div className="mt-1 text-amber-800">{warnings.join(" · ")}</div>
            </div>
          </div>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по артикулу или названию"
            aria-label="Поиск по артикулу или названию"
            className="min-h-12 w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-sm">
            <div className="font-semibold text-slate-900">Товары, себестоимость и фулфилмент</div>
            <div className="text-xs text-slate-500">
              {loading ? "Загрузка…" : `Показано ${flt.length} из ${rows.length} · без себеса ${missing}`}
            </div>
          </div>
          {loading ? <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          : (
            <>
            <div className="table-cards-lg scroll-x p-3 lg:p-0">
              {/* Колонок стало восемь, а вширь таблица не выросла: фиксированные
                  ширины ужаты, название тянется само. До правки последняя графа
                  обрывалась за краем экрана уже на шести. Ширину в 1000px
                  требует только настоящая таблица — в карточках она бы её и
                  распёрла, поэтому min-w живёт на брейкпоинте. */}
              <table className="w-full table-fixed text-sm lg:min-w-[1000px]">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-[132px] px-3 py-3 text-left">Артикул</th>
                    <th className="px-3 py-3 text-left">Название</th>
                    <th className="w-[88px] px-2 py-3 text-left">Источник</th>
                    <th className="w-[160px] px-3 py-3 text-left">Категория</th>
                    <th className="w-[104px] px-2 py-3 text-right">Себес ₽</th>
                    <th className="w-[112px] px-2 py-3 text-right">Фулфилмент ₽</th>
                    <th className="w-[100px] px-3 py-3 text-right">Итого ₽</th>
                    <th className="w-[56px] px-2 py-3 text-center">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {flt.map((r) => {
                    const val = edits[r.article] ?? String(r.cost_rub || "");
                    const ffVal = ffEdits[r.article] ?? String(r.fulfillment_rub || "");
                    const catVal = catEdits[r.article] ?? r.category ?? "";
                    const patch = rowPatch(r);
                    const dirty = Object.keys(patch).length > 0;
                    // «Итого» показываем по тому, что в полях прямо сейчас, —
                    // человек должен видеть сумму до сохранения, а не после.
                    const total = (Number(val) || 0) + (Number(ffVal) || 0);
                    return (
                      <tr key={r.article} className="border-t border-slate-100 hover:bg-amber-50/30">
                        <td data-cell="title" className="px-3 py-3 align-middle font-semibold text-slate-800">
                          <div className="break-anywhere lg:truncate" title={r.article}>{r.article}</div>
                        </td>
                        <td data-label="Название" className="px-3 py-3 align-middle text-slate-500">
                          {/* Подсказка по наведению на касании недоступна, поэтому
                              до десктопа название переносится целиком. */}
                          <div className="break-anywhere lg:truncate" title={r.name}>{r.name}</div>
                        </td>
                        <td data-label="Источник" className="px-2 py-3 align-middle text-xs font-medium text-slate-500">
                          <div className="break-anywhere lg:truncate" title={r.inherited_from ? `${r.source} · ${r.inherited_from}` : r.source}>
                            {r.source}
                          </div>
                        </td>
                        <td data-label="Категория" className="px-3 py-3 align-middle">
                          <input value={catVal} onChange={(e) => setCatEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") save(r.article, patch); }}
                            list="cost-categories" placeholder="без категории"
                            aria-label={`Категория для ${r.article}`}
                            className="min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100" />
                        </td>
                        <td data-label="Себес ₽" className="px-2 py-3 align-middle text-right">
                          <input value={val} onChange={(e) => setEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") save(r.article, patch); }}
                            aria-label={`Себестоимость для ${r.article}`}
                            type="number" min="0"
                            className={`min-h-10 w-full rounded-lg border px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-100 ${r.cost_rub > 0 ? "border-slate-200 text-slate-900" : "border-amber-300 bg-amber-50 text-amber-900"}`} />
                        </td>
                        <td data-label="Фулфилмент ₽" className="px-2 py-3 align-middle text-right">
                          {/* Пустой фулфилмент подсвечен мягче себеса: он бывает
                              честным нулём (свой склад), а себес нулевым не бывает. */}
                          <input value={ffVal} onChange={(e) => setFfEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") save(r.article, patch); }}
                            aria-label={`Фулфилмент для ${r.article}`}
                            type="number" min="0"
                            className={`min-h-10 w-full rounded-lg border px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-100 ${r.fulfillment_rub > 0 ? "border-slate-200 text-slate-900" : "border-slate-200 bg-slate-50 text-slate-400"}`} />
                        </td>
                        <td data-label="Итого ₽" className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900"
                          title="Себес + фулфилмент — столько уходит в маржу WB, Ozon и ОПиУ">
                          {total > 0 ? rub(total) : "—"}
                        </td>
                        <td data-cell="actions" className="px-2 py-3 text-center align-middle">
                          {saving === r.article ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                            : dirty ? <button onClick={() => save(r.article, patch)} aria-label={`Сохранить ${r.article}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-amber-600 hover:bg-amber-100 hover:text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-200"><Check className="h-4 w-4" /></button>
                            : savedAt[r.article] ? <Check className="mx-auto h-5 w-5 text-emerald-500" /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="cost-categories">
              {knownCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
