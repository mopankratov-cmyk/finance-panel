"use client";

import { Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProductRow } from "@/lib/warehouse/productRow";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";

// Себестоимость вносится в рублях — курс тогда не нужен ни приёмке, ни остаткам.
const CURRENCIES = ["RUB", "CNY", "USD"] as const;

/** Пустая форма нового товара: артикул обязателен, остальное дозаполняется по мере жизни. */
const emptyDraft = (entityId: string | null) => ({
  legalEntityId: entityId,
  article: "",
  name: "",
  barcode: "",
  category: "",
  brand: "",
  nmId: "",
  factoryPrice: "",
  factoryCurrency: "RUB" as (typeof CURRENCIES)[number],
  weightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  minStock: "",
  season: "" as "" | "summer" | "winter",
  note: "",
});

type Draft = ReturnType<typeof emptyDraft>;

const fromRow = (row: ProductRow): Draft => ({
  legalEntityId: row.legalEntityId,
  article: row.article,
  name: row.name,
  barcode: row.barcode ?? "",
  category: row.category ?? "",
  brand: row.brand ?? "",
  nmId: row.nmId === null ? "" : String(row.nmId),
  factoryPrice: row.factoryPrice === null ? "" : String(row.factoryPrice),
  factoryCurrency: row.factoryCurrency,
  weightKg: row.weightKg === null ? "" : String(row.weightKg),
  lengthCm: row.lengthCm === null ? "" : String(row.lengthCm),
  widthCm: row.widthCm === null ? "" : String(row.widthCm),
  heightCm: row.heightCm === null ? "" : String(row.heightCm),
  minStock: row.minStock === null ? "" : String(row.minStock),
  season: row.season ?? "",
  note: row.note ?? "",
});

export function ProductsTab({
  entityId,
  entities,
  refreshKey,
}: {
  entityId: string;
  entities: LegalEntityRow[];
  refreshKey: number;
}) {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [onlyEntity, setOnlyEntity] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (onlyEntity) params.set("entity", entityId);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/warehouse/products?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить товары");
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить товары");
    } finally {
      setLoading(false);
    }
  }, [entityId, onlyEntity, query]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey, query]);

  const save = async () => {
    if (!editing) return;
    if (!editing.draft.article.trim()) { setError("Укажите артикул"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...editing.draft, season: editing.draft.season || null };
      const res = await fetch(
        editing.id ? `/api/warehouse/products/${editing.id}` : "/api/warehouse/products",
        {
          method: editing.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось сохранить товар");
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить товар");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Draft, label: string, extra?: { placeholder?: string; wide?: boolean }) => (
    <label className={extra?.wide ? "col-span-2" : ""}>
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={String(editing?.draft[key] ?? "")}
        onChange={(e) => setEditing((prev) => prev && ({ ...prev, draft: { ...prev.draft, [key]: e.target.value } }))}
        placeholder={extra?.placeholder}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Артикул, название или штрихкод"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-300"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyEntity} onChange={(e) => setOnlyEntity(e.target.checked)} />
          только этого юрлица
        </label>
        <button
          onClick={() => setEditing({ id: null, draft: emptyDraft(entityId) })}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> Новый товар
        </button>
      </div>

      {editing && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900">
              {editing.id ? `Товар ${editing.draft.article}` : "Новый товар"}
            </p>
            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {field("article", "Артикул", { placeholder: "NV-836-02" })}
            {field("name", "Название", { placeholder: "Куртка NV-836", wide: true })}
            {field("barcode", "Штрихкод")}
            {field("category", "Категория", { placeholder: "Куртки" })}
            {field("brand", "Бренд")}
            {field("nmId", "nmID карточки WB", { placeholder: "если карточка уже есть" })}
            <label>
              <span className="text-xs text-slate-500">Юрлицо</span>
              <select
                value={editing.draft.legalEntityId ?? ""}
                onChange={(e) => setEditing((prev) => prev && ({
                  ...prev, draft: { ...prev.draft, legalEntityId: e.target.value || null },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">не указано</option>
                {entities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>

            <label>
              <span className="text-xs text-slate-500">Себестоимость единицы</span>
              <div className="mt-1 flex gap-1">
                <input
                  value={editing.draft.factoryPrice}
                  onChange={(e) => setEditing((prev) => prev && ({
                    ...prev, draft: { ...prev.draft, factoryPrice: e.target.value },
                  }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                />
                <select
                  value={editing.draft.factoryCurrency}
                  onChange={(e) => setEditing((prev) => prev && ({
                    ...prev, draft: { ...prev.draft, factoryCurrency: e.target.value as (typeof CURRENCIES)[number] },
                  }))}
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-700"
                >
                  {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
              </div>
            </label>
            {field("weightKg", "Вес единицы, кг")}
            {field("lengthCm", "Упаковка: длина, см")}
            {field("widthCm", "Упаковка: ширина, см")}
            {field("heightCm", "Упаковка: высота, см")}
            {field("minStock", "Неснижаемый остаток")}
            <label>
              <span className="text-xs text-slate-500">Сезон</span>
              <select
                value={editing.draft.season}
                onChange={(e) => setEditing((prev) => prev && ({
                  ...prev, draft: { ...prev.draft, season: e.target.value as Draft["season"] },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">круглый год</option>
                <option value="summer">летний (март–июль)</option>
                <option value="winter">зимний (август–февраль)</option>
              </select>
            </label>
            {field("note", "Заметка", { wide: true })}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">
              Отмена
            </button>
            <p className="text-xs text-slate-400">
              Себестоимость вносится в рублях: тогда приёмке не нужен курс. Вес и габариты нужны для расчёта
              логистики и бюджета закупки — без них позиция не считается.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю товары…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Товаров нет</p>
          <p className="mt-1 text-sm text-slate-400">
            {query ? "Ничего не нашлось по запросу." : "Заведите первый товар — артикул придумываете вы, карточка WB не нужна."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Артикул</th>
                <th className="px-4 py-3 text-left font-medium">Название</th>
                <th className="px-4 py-3 text-left font-medium">Категория</th>
                <th className="px-4 py-3 text-left font-medium">Юрлицо</th>
                <th className="px-4 py-3 text-right font-medium">Себестоимость</th>
                <th className="px-4 py-3 text-left font-medium">WB</th>
                <th className="px-4 py-3 text-left font-medium">Чего не хватает</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setEditing({ id: row.id, draft: fromRow(row) })}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.article}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-slate-600">{row.name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.category ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.legalEntityName ?? <span className="text-amber-600">не указано</span>}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {row.factoryPrice === null
                      ? <span className="text-slate-300">—</span>
                      : `${row.factoryPrice} ${row.factoryCurrency}`}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {row.nmId ?? <span className="text-slate-300">нет карточки</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.missing.length === 0
                      ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">всё есть</span>
                      : <span className="text-xs text-amber-600">{row.missing.join(", ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Артикул — ваш, карточка маркетплейса необязательна: товар можно завести и принять до того, как появится
        карточка на WB, а nmID проставить позже. Клик по строке открывает карточку.
      </p>
    </div>
  );
}
