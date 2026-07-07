"use client";

import { useEffect, useState } from "react";
import { Loader2, Coins, Plus, Check } from "lucide-react";

interface Row { article: string; name: string; cost_rub: number; brand: string; category: string }

export default function CostsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [catEdits, setCatEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [newArt, setNewArt] = useState("");
  const [newCost, setNewCost] = useState("");

  const load = async () => {
    setLoading(true);
    try { const r = await fetch("/api/costs", { cache: "no-store" }); const j = await r.json(); setRows(j.rows ?? []); }
    catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const knownCategories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));

  const save = async (article: string, val: string, name?: string, category?: string) => {
    setSaving(article);
    try {
      const r = await fetch("/api/costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ article, cost_rub: Number(val) || 0, name, category }) });
      if (r.ok) {
        setRows((rs) => {
          const ex = rs.find((x) => x.article === article);
          if (ex) { ex.cost_rub = Number(val) || 0; if (category !== undefined) ex.category = category; return [...rs]; }
          return [{ article, name: name || article, cost_rub: Number(val) || 0, brand: "", category: category || "" }, ...rs];
        });
        setSavedAt((s) => ({ ...s, [article]: Date.now() }));
        setEdits((e) => { const c = { ...e }; delete c[article]; return c; });
        setCatEdits((e) => { const c = { ...e }; delete c[article]; return c; });
      }
    } catch { /* ignore */ }
    setSaving(null);
  };

  const flt = rows.filter((r) => { const s = q.toLowerCase().trim(); return !s || r.article.toLowerCase().includes(s) || r.name.toLowerCase().includes(s); });
  const filled = rows.filter((r) => r.cost_rub > 0).length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Coins className="h-5 w-5" /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Себестоимость</h1>
          <p className="text-sm text-gray-500">Себес по артикулам — питает маржу WB, Ozon, ОПиУ {!loading && <span className="text-gray-400">· заполнено {filled}/{rows.length}</span>}</p>
        </div>
      </div>

      {/* добавить */}
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row">
        <input value={newArt} onChange={(e) => setNewArt(e.target.value)} placeholder="Артикул (offer_id)" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />
        <input value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="Себес ₽" type="number" className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />
        <button onClick={() => { if (newArt.trim()) { save(newArt.trim(), newCost); setNewArt(""); setNewCost(""); } }} disabled={!newArt.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"><Plus className="h-4 w-4" /> Добавить</button>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по артикулу/названию" className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-12 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          : (
            <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">Артикул</th><th className="hidden px-3 py-2 text-left sm:table-cell">Название</th><th className="hidden px-3 py-2 text-left md:table-cell">Категория</th><th className="px-3 py-2 text-right">Себес ₽</th><th className="w-10"></th></tr></thead>
              <tbody>
                {flt.map((r) => {
                  const val = edits[r.article] ?? String(r.cost_rub || "");
                  const catVal = catEdits[r.article] ?? r.category ?? "";
                  const dirty = (edits[r.article] != null && edits[r.article] !== String(r.cost_rub || "")) || (catEdits[r.article] != null && catEdits[r.article] !== (r.category ?? ""));
                  return (
                    <tr key={r.article} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{r.article}</td>
                      <td className="hidden max-w-xs truncate px-3 py-2 text-gray-500 sm:table-cell">{r.name}</td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <input value={catVal} onChange={(e) => setCatEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") save(r.article, val, undefined, catVal); }}
                          list="cost-categories" placeholder="без категории"
                          className="w-32 rounded border border-gray-200 px-2 py-1 text-sm focus:border-amber-500 focus:outline-none" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input value={val} onChange={(e) => setEdits((s) => ({ ...s, [r.article]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") save(r.article, val, undefined, catVal); }}
                          type="number" className={`w-24 rounded border px-2 py-1 text-right text-sm focus:outline-none ${r.cost_rub > 0 ? "border-gray-200" : "border-amber-300 bg-amber-50"}`} />
                      </td>
                      <td className="px-2 text-center">
                        {saving === r.article ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                          : dirty ? <button onClick={() => save(r.article, val, undefined, catVal)} className="text-amber-600 hover:text-amber-800"><Check className="h-4 w-4" /></button>
                          : savedAt[r.article] ? <Check className="h-4 w-4 text-emerald-500" /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="cost-categories">
              {knownCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
            </>
          )}
      </div>
    </div>
  );
}
