"use client";

import { useEffect, useState } from "react";
import { Loader2, Coins, Plus, Check, Search } from "lucide-react";
import { ActionableError } from "@/components/ui/ActionableError";

interface Row { article: string; name: string; cost_rub: number; brand: string; category: string }

export default function CostsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [catEdits, setCatEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [newArt, setNewArt] = useState("");
  const [newCost, setNewCost] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/costs", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `Ошибка ${r.status}`);
      setRows(j.rows ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить себестоимость");
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const knownCategories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));

  const save = async (article: string, val: string, name?: string, category?: string) => {
    setSaving(article);
    setSaveError("");
    try {
      const r = await fetch("/api/costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ article, cost_rub: Number(val) || 0, name, category }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Ошибка ${r.status}`);
      setRows((rs) => {
        const ex = rs.find((x) => x.article === article);
        if (ex) { ex.cost_rub = Number(val) || 0; if (category !== undefined) ex.category = category; return [...rs]; }
        return [{ article, name: name || article, cost_rub: Number(val) || 0, brand: "", category: category || "" }, ...rs];
      });
      setSavedAt((s) => ({ ...s, [article]: Date.now() }));
      setEdits((e) => { const c = { ...e }; delete c[article]; return c; });
      setCatEdits((e) => { const c = { ...e }; delete c[article]; return c; });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Не удалось сохранить себестоимость");
    }
    setSaving(null);
  };

  const flt = rows.filter((r) => { const s = q.toLowerCase().trim(); return !s || r.article.toLowerCase().includes(s) || r.name.toLowerCase().includes(s); });
  const filled = rows.filter((r) => r.cost_rub > 0).length;
  const missing = Math.max(0, rows.length - filled);
  const fillPct = rows.length ? Math.round((filled / rows.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-0 w-full max-w-none space-y-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Coins className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900">Себестоимость</h1>
              <p className="text-sm text-slate-500">
                Себес по артикулам — питает маржу WB, Ozon, ОПиУ
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[430px]">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Всего SKU</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{loading ? "—" : rows.length}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">Заполнено</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-700">{loading ? "—" : `${filled}/${rows.length}`}</div>
            </div>
            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-amber-600">Покрытие</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-amber-700">{loading ? "—" : `${fillPct}%`}</div>
            </div>
          </div>
        </div>

        {/* добавить */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_160px]">
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
              className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <button
              onClick={() => { if (newArt.trim()) { save(newArt.trim(), newCost); setNewArt(""); setNewCost(""); } }}
              disabled={!newArt.trim()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Добавить
            </button>
          </div>
        </div>

        {error ? <ActionableError message={error} label="Себестоимость" onRetry={load} /> : null}
        {saveError ? <ActionableError message={saveError} label="Сохранение себестоимости" compact tone="amber" /> : null}

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
            <div className="font-semibold text-slate-900">Товары и себестоимость</div>
            <div className="text-xs text-slate-500">
              {loading ? "Загрузка…" : `Показано ${flt.length} из ${rows.length} · без себеса ${missing}`}
            </div>
          </div>
          {loading ? <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] table-fixed text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-[240px] px-4 py-3 text-left">Артикул</th>
                    <th className="px-4 py-3 text-left">Название</th>
                    <th className="w-[260px] px-4 py-3 text-left">Категория</th>
                    <th className="w-[160px] px-4 py-3 text-right">Себес ₽</th>
                    <th className="w-[80px] px-3 py-3 text-center">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {flt.map((r) => {
                    const val = edits[r.article] ?? String(r.cost_rub || "");
                    const catVal = catEdits[r.article] ?? r.category ?? "";
                    const dirty = (edits[r.article] != null && edits[r.article] !== String(r.cost_rub || "")) || (catEdits[r.article] != null && catEdits[r.article] !== (r.category ?? ""));
                    return (
                      <tr key={r.article} className="border-t border-slate-100 hover:bg-amber-50/30">
                        <td className="px-4 py-3 align-middle font-semibold text-slate-800">
                          <div className="truncate" title={r.article}>{r.article}</div>
                        </td>
                        <td className="px-4 py-3 align-middle text-slate-500">
                          <div className="truncate" title={r.name}>{r.name}</div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <input value={catVal} onChange={(e) => setCatEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") save(r.article, val, undefined, catVal); }}
                            list="cost-categories" placeholder="без категории"
                            aria-label={`Категория для ${r.article}`}
                            className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100" />
                        </td>
                        <td className="px-4 py-3 align-middle text-right">
                          <input value={val} onChange={(e) => setEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") save(r.article, val, undefined, catVal); }}
                            aria-label={`Себестоимость для ${r.article}`}
                            type="number" className={`min-h-10 w-full rounded-lg border px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-100 ${r.cost_rub > 0 ? "border-slate-200 text-slate-900" : "border-amber-300 bg-amber-50 text-amber-900"}`} />
                        </td>
                        <td className="px-3 py-3 text-center align-middle">
                          {saving === r.article ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                            : dirty ? <button onClick={() => save(r.article, val, undefined, catVal)} aria-label={`Сохранить ${r.article}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-amber-600 hover:bg-amber-100 hover:text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-200"><Check className="h-4 w-4" /></button>
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
