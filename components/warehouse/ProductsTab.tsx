"use client";

import { Building2, Download, ListPlus, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductRow } from "@/lib/warehouse/productRow";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { WbProductImage } from "@/components/wb/WbProductImage";
import type { VariantRow } from "@/app/api/warehouse/variants/route";
import type { ProductImportResult, ProductImportPlanRow } from "@/app/api/warehouse/products/import/route";
import { hasWildberriesSource, noWildberriesSourceReason } from "@/lib/warehouse/cabinetChannels";

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
  photoUrl: "",
  factoryPrice: "",
  factoryCurrency: "RUB" as (typeof CURRENCIES)[number],
  weightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  minStock: "",
  season: "" as "" | "summer" | "winter",
  note: "",
  // Модель и цвет — иерархия склада; источник — карточка WB, правится руками.
  model: "",
  color: "",
  isNovelty: false,
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
  photoUrl: row.photoUrl ?? "",
  factoryPrice: row.factoryPrice === null ? "" : String(row.factoryPrice),
  factoryCurrency: row.factoryCurrency,
  weightKg: row.weightKg === null ? "" : String(row.weightKg),
  lengthCm: row.lengthCm === null ? "" : String(row.lengthCm),
  widthCm: row.widthCm === null ? "" : String(row.widthCm),
  heightCm: row.heightCm === null ? "" : String(row.heightCm),
  minStock: row.minStock === null ? "" : String(row.minStock),
  season: row.season ?? "",
  note: row.note ?? "",
  model: row.model ?? "",
  color: row.color ?? "",
  isNovelty: row.isNovelty,
});

export function ProductsTab({
  entityId,
  entities,
  refreshKey,
  external = false,
}: {
  entityId: string;
  entities: LegalEntityRow[];
  refreshKey: number;
  /** Внешняя компания: справочник у неё свой, а инструменты, работающие сразу
   *  по всем юрлицам, ей закрыты — и показывать их незачем. */
  external?: boolean;
}) {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [onlyEntity, setOnlyEntity] = useState(true);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [newSize, setNewSize] = useState({ sizeLabel: "", barcode: "" });
  const [variantBusy, setVariantBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [owners, setOwners] = useState(false);
  const [ownersResult, setOwnersResult] = useState<string | null>(null);
  const [ownerConflicts, setOwnerConflicts] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importPlan, setImportPlan] = useState<ProductImportResult | null>(null);
  const [pickedBrands, setPickedBrands] = useState<string[]>([]);
  const [withStale, setWithStale] = useState(false);

  // Все три кнопки ниже читают карточки через Content API Wildberries. У юрлица
  // с одними Ozon-кабинетами читать нечем — и честнее сказать это заранее, чем
  // отправить человека ждать обхода, который не может закончиться.
  const entity = entities.find((row) => row.id === entityId) ?? null;
  const wbSource = entity ? hasWildberriesSource(entity.cabinets) : true;
  const noWbReason = entity && !wbSource ? noWildberriesSourceReason(entity.name, entity.cabinets) : null;

  // Поиск набирают посимвольно, и ответы возвращаются вразнобой: более ранний,
  // более длинный, может лечь последним — человек ищет одно, а видит другое.
  // Счётчик отсекает всё, что пришло не к последнему запросу.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (onlyEntity) params.set("entity", entityId);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/warehouse/products?${params}`, { cache: "no-store", signal: controller.signal });
      const json = await res.json();
      if (current !== requestId.current) return;
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить товары");
      setRows(json.data ?? []);
    } catch (e) {
      if (current !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Не удалось загрузить товары");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [entityId, onlyEntity, query]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey, query]);

  // Размеры грузятся только при открытии карточки: в списке они не нужны.
  const loadVariants = async (productId: string) => {
    setVariants([]);
    try {
      const res = await fetch(`/api/warehouse/variants?product=${productId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить размеры");
      setVariants(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить размеры");
    }
  };

  const addSize = async (productId: string) => {
    if (!newSize.sizeLabel.trim()) { setError("Укажите размер"); return; }
    setVariantBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, sizeLabel: newSize.sizeLabel, barcode: newSize.barcode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось добавить размер");
      setNewSize({ sizeLabel: "", barcode: "" });
      await loadVariants(productId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить размер");
    } finally {
      setVariantBusy(false);
    }
  };

  // Размеры и баркоды берутся из карточек WB: вбивать их руками для сотен позиций
  // бессмысленно, а опечатка в баркоде ломает и ФБС, и коды маркировки.
  const importFromWb = async () => {
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/warehouse/variants/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить размеры");
      const d = json.data;
      const parts = [`заведено ${d.created}`, `дополнено ${d.updated}`, `моделей ${d.products}`];
      if (d.linkedByArticle > 0) parts.push(`связано с карточкой WB ${d.linkedByArticle}`);
      if (d.skippedNoProduct > 0) parts.push(`пропущено без товара ${d.skippedNoProduct}`);
      if (d.partial) parts.push("каталог WB отдан не полностью");
      // Модель и цвет из карточки — поля добавляет тот же импорт; старый роут их не отдаёт.
      if (typeof d.modelsFilled === "number" && typeof d.colorsFilled === "number") {
        parts.push(`проставлено моделей ${d.modelsFilled}, цветов ${d.colorsFilled}`);
      }
      // Кабинет, который не прочитался, раньше молчал: роут его отмечал, а экран
      // не показывал — и цифры выглядели полными, хотя половину не прочитали.
      const cold = (d.cabinets ?? []).filter((row: { cold: boolean }) => row.cold);
      if (cold.length > 0) parts.push(`не прочитаны: ${cold.map((row: { name: string }) => row.name).join(", ")}`);
      setImportResult(parts.join(" · "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить размеры");
    } finally {
      setImporting(false);
    }
  };

  // Сначала разведка, потом запись: человек видит, что именно появится в
  // справочнике, и по каким брендам. Кнопка, которая молча заводит полсотни
  // чужих позиций, — это не помощь.
  const scanCatalog = async (apply: boolean) => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          apply,
          includeStale: withStale,
          brands: apply && pickedBrands.length > 0 ? pickedBrands : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать карточки");
      const data = json.data as ProductImportResult;
      setImportPlan(data);
      if (!apply) setPickedBrands(data.plan.map((row) => row.brand));
      if (apply) { setPickedBrands([]); await load(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать карточки");
    } finally {
      setScanning(false);
    }
  };

  // Кому принадлежит товар — вопрос с ответом в карточках WB: номер карточки
  // глобально уникален, и кабинет, в котором она заведена, связан с юрлицом.
  const detectOwners = async () => {
    setOwners(true);
    setError(null);
    setOwnersResult(null);
    setOwnerConflicts([]);
    try {
      const res = await fetch("/api/warehouse/products/owners", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось определить юрлица");
      const d = json.data;
      const parts = [`проставлено ${d.assigned}`];
      if (d.byNm > 0) parts.push(`по карточке ${d.byNm}`);
      if (d.byArticle > 0) parts.push(`по артикулу ${d.byArticle}`);
      if (d.byLabel > 0) parts.push(`по метке из финансов ${d.byLabel}`);
      parts.push(`подтверждено ${d.confirmed}`);
      if (d.unresolved.length > 0) parts.push(`владелец неизвестен у ${d.unresolved.length}`);
      const failed = d.cabinets.filter((row: { failed: boolean }) => row.failed);
      if (failed.length > 0) parts.push(`не прочитаны кабинеты: ${failed.map((row: { name: string }) => row.name).join(", ")}`);
      setOwnersResult(parts.join(" · "));
      setOwnerConflicts(d.conflicts.map(
        (row: { article: string; current: string; found: string; evidence: string }) =>
          `${row.article}: стоит «${row.current}», карточка в «${row.evidence}» → «${row.found}»`,
      ));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось определить юрлица");
    } finally {
      setOwners(false);
    }
  };

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

  /** `wide` растягивает поле на две колонки — но только там, где их и правда
   *  две: без брейкпоинта span 2 заставлял одноколоночную сетку телефона
   *  вырасти до двух столбцов по ~150 px, и подписи ломались в три строки.
   *  `mode` открывает цифровую клавиатуру там, где вводят числа. */
  const field = (
    key: keyof Draft,
    label: string,
    extra?: { placeholder?: string; wide?: boolean; mode?: "numeric" | "decimal" },
  ) => (
    <label className={extra?.wide ? "sm:col-span-2" : ""}>
      <span className="text-xs text-slate-500">{label}</span>
      <input
        inputMode={extra?.mode}
        value={String(editing?.draft[key] ?? "")}
        onChange={(e) => setEditing((prev) => prev && ({ ...prev, draft: { ...prev.draft, [key]: e.target.value } }))}
        placeholder={extra?.placeholder}
        className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-300 lg:min-h-0 lg:py-2"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {importing && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Читаю карточки Wildberries — несколько минут.
        </div>
      )}
      {importResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          Размеры из WB: {importResult}
        </div>
      )}
      {owners && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Читаю карточки кабинетов — несколько минут.
        </div>
      )}
      {ownersResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          Юрлица по карточкам: {ownersResult}
        </div>
      )}
      {ownerConflicts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Карточка спорит с тем, что записано — не трогали, решите руками:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {ownerConflicts.map((row) => <li key={row}>{row}</li>)}
          </ul>
        </div>
      )}

      {noWbReason && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {noWbReason} Отгружать и возвращать через этот кабинет можно как обычно — не работает только чтение справочника.
        </div>
      )}

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
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600 lg:min-h-0">
          <input type="checkbox" checked={onlyEntity} onChange={(e) => setOnlyEntity(e.target.checked)} className="h-5 w-5 lg:h-4 lg:w-4" />
          только этого юрлица
        </label>
        <button
          onClick={() => void importFromWb()}
          disabled={importing || !wbSource}
          title={noWbReason ?? "Прочитать карточки Wildberries и заполнить размеры с баркодами. Занимает несколько минут."}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> {importing ? "Читаю карточки WB…" : "Размеры из WB"}
        </button>
        <button
          onClick={() => void scanCatalog(false)}
          disabled={scanning || !wbSource}
          title={noWbReason ?? "Найти в карточках кабинетов товары, которых нет в справочнике. Сначала покажет список."}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <ListPlus className="h-4 w-4" /> {scanning ? "Читаю карточки…" : "Товары из карточек"}
        </button>
        {!external && <button
          onClick={() => void detectOwners()}
          disabled={owners}
          title="Прочитать карточки своих кабинетов и проставить товарам юрлицо владельца. Занимает несколько минут."
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Building2 className="h-4 w-4" /> {owners ? "Определяю…" : "Юрлица по карточкам"}
        </button>}
        <button
          onClick={() => { setEditing({ id: null, draft: emptyDraft(entityId) }); setVariants([]); }}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" /> Новый товар
        </button>
      </div>

      {importPlan && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {importPlan.applied ? (
            <p className="text-sm text-emerald-700">
              Заведено товаров: {importPlan.created}. Себестоимость у них пустая — карточка WB цену закупки не знает.
            </p>
          ) : importPlan.plan.length === 0 && importPlan.stale.length === 0 ? (
            <p className="text-sm text-slate-500">Все карточки кабинетов уже есть в справочнике.</p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">Есть в карточках, нет в справочнике — отметьте, что заводить:</p>
              <div className="mt-2 space-y-1">
                {importPlan.plan.map((row: ProductImportPlanRow) => (
                  <label key={row.brand} className="flex min-h-11 items-start gap-2 py-1 text-sm text-slate-600 lg:min-h-0 lg:py-0">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 lg:h-4 lg:w-4"
                      checked={pickedBrands.includes(row.brand)}
                      onChange={(e) => setPickedBrands(e.target.checked
                        ? [...pickedBrands, row.brand]
                        : pickedBrands.filter((brand) => brand !== row.brand))}
                    />
                    <span>
                      <span className="font-medium text-slate-800">{row.brand}</span> — {row.cards.length} шт:{" "}
                      <span className="text-slate-400">{row.cards.slice(0, 6).map((card) => card.article).join(", ")}{row.cards.length > 6 ? " …" : ""}</span>
                    </span>
                  </label>
                ))}
              </div>
              {importPlan.stale.length > 0 && (
                <label className="mt-3 flex min-h-11 items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800 lg:min-h-0">
                  <input type="checkbox" className="mt-1 h-5 w-5 lg:h-4 lg:w-4" checked={withStale} onChange={(e) => { setWithStale(e.target.checked); void scanCatalog(false); }} />
                  <span>
                    Ещё {importPlan.stale.reduce((sum, row) => sum + row.cards.length, 0)} карточек старше полугода без единого заказа —
                    по умолчанию не заводим, чтобы справочник не зарастал мёртвыми позициями.
                    Отметьте, если нужны и они.
                  </span>
                </label>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void scanCatalog(true)}
                  disabled={scanning || pickedBrands.length === 0}
                  className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {scanning ? "Завожу…" : "Завести отмеченные"}
                </button>
                <button onClick={() => setImportPlan(null)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600">
                  Закрыть
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900">
              {editing.id ? `Товар ${editing.draft.article}` : "Новый товар"}
            </p>
            <button onClick={() => setEditing(null)} aria-label="Закрыть карточку" className="tap-hit -mr-1 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {field("article", "Артикул", { placeholder: "NV-836-02" })}
            {field("name", "Название", { placeholder: "Куртка NV-836", wide: true })}
            {field("model", "Модель", { placeholder: "из карточки WB или NV-836" })}
            {field("color", "Цвет", { placeholder: "бежевый" })}
            {field("barcode", "Штрихкод")}
            {field("category", "Категория", { placeholder: "Куртки" })}
            {field("brand", "Бренд")}
            {field("nmId", "nmID карточки WB", { placeholder: "если карточка уже есть", mode: "numeric" })}
            {field("photoUrl", "Фото: ссылка", { placeholder: "если карточки WB ещё нет", wide: true })}
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
                  inputMode="decimal"
                  value={editing.draft.factoryPrice}
                  onChange={(e) => setEditing((prev) => prev && ({
                    ...prev, draft: { ...prev.draft, factoryPrice: e.target.value },
                  }))}
                  className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700 lg:min-h-0 lg:py-2"
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
            {field("weightKg", "Вес единицы, кг", { mode: "decimal" })}
            {field("lengthCm", "Упаковка: длина, см", { mode: "decimal" })}
            {field("widthCm", "Упаковка: ширина, см", { mode: "decimal" })}
            {field("heightCm", "Упаковка: высота, см", { mode: "decimal" })}
            {field("minStock", "Неснижаемый остаток", { mode: "numeric" })}
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
            <label className="flex min-h-11 items-center gap-2 self-end pb-2 text-sm text-slate-700 lg:min-h-0">
              <input
                type="checkbox"
                className="h-5 w-5 lg:h-4 lg:w-4"
                checked={editing.draft.isNovelty}
                onChange={(e) => setEditing((prev) => prev && ({
                  ...prev, draft: { ...prev.draft, isNovelty: e.target.checked },
                }))}
              />
              Новинка
              <span className="text-xs text-slate-400">ещё не торговали</span>
            </label>
            {field("note", "Заметка", { wide: true })}
          </div>

          {editing.id && (
            <div className="mt-4 border-t border-violet-200 pt-4">
              <p className="text-sm font-medium text-slate-900">Размеры</p>

              <div className="mt-3 space-y-1.5">
                {variants.filter((variant) => !variant.isDefault).map((variant) => (
                  <div key={variant.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-16 rounded bg-slate-100 px-2 py-1 text-center font-medium text-slate-700">
                      {variant.sizeLabel}
                    </span>
                    <span className="flex-1 font-mono text-xs text-slate-500">
                      {variant.barcode ?? <span className="text-slate-300">баркод не заведён</span>}
                    </span>
                    {variant.chrtId && <span className="font-mono text-xs text-slate-400">chrt {variant.chrtId}</span>}
                  </div>
                ))}
                {variants.filter((variant) => !variant.isDefault).length === 0 && (
                  <p className="text-xs text-slate-400">Размеров нет — товар считается безразмерным.</p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={newSize.sizeLabel}
                  onChange={(e) => setNewSize({ ...newSize, sizeLabel: e.target.value })}
                  placeholder="Размер: S, 46, 42-44"
                  className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
                />
                <input
                  value={newSize.barcode}
                  onChange={(e) => setNewSize({ ...newSize, barcode: e.target.value })}
                  placeholder="Баркод WB"
                  className="w-52 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
                />
                <button
                  onClick={() => void addSize(editing.id!)}
                  disabled={variantBusy}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 disabled:opacity-50"
                >
                  {variantBusy ? "Добавляю…" : "+ размер"}
                </button>
              </div>
            </div>
          )}

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
        <div className="scroll-x rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium"></th>
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
                  onClick={() => { setEditing({ id: row.id, draft: fromRow(row) }); void loadVariants(row.id); }}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pl-4 pr-0">
                    <WbProductImage
                      nm={row.nmId ?? undefined}
                      src={row.photoUrl ?? undefined}
                      alt={row.article}
                      label={row.article}
                      className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {row.article}
                    {row.isNovelty && (
                      <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-normal text-violet-700">новинка</span>
                    )}
                  </td>
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
    </div>
  );
}
