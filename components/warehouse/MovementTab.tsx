"use client";

import { ArrowRight, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import type { CatalogVariantRow } from "@/app/api/warehouse/variants/route";
import type { StockBalancesResponse } from "@/app/api/warehouse/balances/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { warehouseKindSuffix } from "@/lib/warehouse/warehouseKind";
import { MARKETPLACE_LABEL } from "@/lib/warehouse/cabinetChannels";

type Mode = "transfer" | "return";

interface DraftLine { variantId: string; qty: string; defectQty: string }

/** Перемещение и возврат — два движения одной природы: товар меняет место.
 *  Живут на одной вкладке, потому что оператор выбирает между ними, а не ищет
 *  каждое в своём углу. */
export function MovementTab({
  entityId,
  entity,
  warehouses,
  refreshKey,
  onChanged,
}: {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  refreshKey: number;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("transfer");
  const [balances, setBalances] = useState<StockBalancesResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogVariantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [fromWarehouse, setFromWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [cabinetId, setCabinetId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ variantId: "", qty: "", defectQty: "" }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Остатки нужны перемещению, справочник — возврату: вернуть могут и то,
      // чего на складе давно нет, и по остаткам такую позицию не найти.
      const [balancesRes, catalogRes] = await Promise.all([
        fetch(`/api/warehouse/balances?entity=${entityId}`, { cache: "no-store" }),
        fetch("/api/warehouse/variants", { cache: "no-store" }),
      ]);
      const balancesJson = await balancesRes.json();
      if (!balancesRes.ok) throw new Error(balancesJson.error || "Не удалось загрузить остатки");
      setBalances(balancesJson.data);
      const catalogJson = await catalogRes.json();
      if (catalogRes.ok) setCatalog(catalogJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить остатки");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    if (!fromWarehouse && warehouses.length > 0) setFromWarehouse(warehouses[0].id);
    if (!toWarehouse && warehouses.length > 1) setToWarehouse(warehouses[1].id);
    if (!cabinetId && entity?.cabinets.length) setCabinetId(entity.cabinets[0].cabinetId);
  }, [warehouses, entity, fromWarehouse, toWarehouse, cabinetId]);

  // Перемещать можно только то, что лежит на складе-источнике; возвращать — любой
  // товар справочника, потому что на складе его может уже не быть.
  const available = useMemo(
    () => (balances?.rows ?? []).filter((row) => row.warehouseId === fromWarehouse && row.qty > 0),
    [balances, fromWarehouse],
  );
  const returnable = useMemo(
    () => catalog.map((row) => ({
      variantId: row.id,
      article: row.article,
      sizeLabel: row.sizeLabel,
      nmId: row.nmId,
    })),
    [catalog],
  );

  const options = mode === "transfer" ? available : returnable;

  const reset = () => {
    setLines([{ variantId: "", qty: "", defectQty: "" }]);
    setNote("");
  };

  const submit = async () => {
    const payloadLines = lines
      .filter((line) => line.variantId && Number(line.qty) > 0)
      .map((line) => ({
        variantId: line.variantId,
        qty: Number(line.qty),
        defectQty: Number(line.defectQty || 0),
      }));
    if (payloadLines.length === 0) { setError("Добавьте позиции с количеством"); return; }

    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const url = mode === "transfer" ? "/api/warehouse/transfers" : "/api/warehouse/returns";
      const body = mode === "transfer"
        ? { entityId, fromWarehouseId: fromWarehouse, toWarehouseId: toWarehouse, note, lines: payloadLines }
        : { entityId, warehouseId: fromWarehouse, cabinetId, note, lines: payloadLines };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось провести документ");
      setDone(mode === "transfer"
        ? `Перемещено ${formatNumber(json.data.qty)} шт`
        : `Возвращено ${formatNumber(json.data.qty)} шт${json.data.defects ? `, из них брак ${json.data.defects}` : ""}`);
      reset();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось провести документ");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю остатки…</div>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{done}</div>}

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {([["transfer", "Перемещение", ArrowRight], ["return", "Возврат с МП", Undo2]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => { setMode(key); reset(); setDone(null); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === key ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {mode === "transfer" && warehouses.length < 2 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Склад пока один — перемещать некуда. Заведите второй на вкладке «Склады»: для фуры между городами
          подойдёт тип «в пути», тогда товар в дороге останется в остатках.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">{mode === "transfer" ? "Откуда" : "Куда приехал"}</span>
        <select
          value={fromWarehouse}
          onChange={(e) => {
            const next = e.target.value;
            setFromWarehouse(next);
            // Приёмник не должен молча совпасть с источником: список его тогда
            // не показывает, а состояние остаётся прежним — и отправка падает.
            if (next === toWarehouse) {
              setToWarehouse(warehouses.find((warehouse) => warehouse.id !== next)?.id ?? "");
            }
            reset();
          }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}{warehouseKindSuffix(warehouse.kind)}
            </option>
          ))}
        </select>

        {mode === "transfer" ? (
          <>
            <ArrowRight className="h-4 w-4 text-slate-400" />
            <select
              value={toWarehouse}
              onChange={(e) => setToWarehouse(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
            >
              {warehouses.filter((warehouse) => warehouse.id !== fromWarehouse).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}{warehouseKindSuffix(warehouse.kind)}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span className="text-sm text-slate-500">из кабинета</span>
            <select
              value={cabinetId}
              onChange={(e) => setCabinetId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
            >
              {(entity?.cabinets ?? []).map((link) => (
                <option key={link.cabinetId} value={link.cabinetId}>
                  {link.cabinetName} · {MARKETPLACE_LABEL[link.marketplace]}{link.relation === "agent" ? " · агент" : ""}
                </option>
              ))}
            </select>
          </>
        )}

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий"
          className="min-w-40 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
        />
      </div>

      {options.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            {mode === "transfer" ? "На складе пусто" : "Нечего возвращать"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {mode === "transfer"
              ? "Перемещать нечего: на выбранном складе нет остатка."
              : "Возврат оформляется по позициям, которые уже проходили через склад."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="space-y-2">
            {lines.map((line, index) => {
              const chosen = options.find((row) => row.variantId === line.variantId);
              const stock = mode === "transfer"
                ? available.find((row) => row.variantId === line.variantId)?.qty ?? 0
                : null;
              const tooMuch = stock !== null && Number(line.qty || 0) > stock;
              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <WbProductImage
                    nm={chosen?.nmId ?? undefined}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white object-cover"
                  />
                  <select
                    value={line.variantId}
                    onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, variantId: e.target.value } : item))}
                    className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                  >
                    <option value="">выберите позицию</option>
                    {options.map((row) => (
                      <option key={row.variantId} value={row.variantId}>
                        {variantLabel(row.article, row.sizeLabel)}
                        {"qty" in row ? ` — на складе ${row.qty}` : ""}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="numeric"
                    value={line.qty}
                    onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, qty: e.target.value.replace(/[^\d]/g, "") } : item))}
                    placeholder="кол-во"
                    className={`w-24 rounded-lg border px-3 py-1.5 text-right text-sm placeholder:text-slate-300 ${
                      tooMuch ? "border-red-300 bg-red-50" : "border-slate-200"
                    }`}
                  />
                  {mode === "return" && (
                    <input
                      inputMode="numeric"
                      value={line.defectQty}
                      onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, defectQty: e.target.value.replace(/[^\d]/g, "") } : item))}
                      placeholder="брак"
                      title="Сколько из вернувшегося непригодно — спишется сразу"
                      className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm placeholder:text-slate-300"
                    />
                  )}
                  {lines.length > 1 && (
                    <button
                      onClick={() => setLines(lines.filter((_, i) => i !== index))}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setLines([...lines, { variantId: "", qty: "", defectQty: "" }])}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
            >
              + позиция
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving || (mode === "transfer" && !toWarehouse)}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Провожу…" : mode === "transfer" ? "Переместить" : "Оприходовать возврат"}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        {mode === "transfer"
          ? "Перемещение не меняет деньги: товар списывается с одного склада и приходуется на другой по той же себестоимости. Долгий путь моделируется складом с типом «в пути» — товар в дороге виден в остатках, а не исчезает."
          : "Годное возвращается в остаток, брак списывается сразу — иначе он уехал бы обратно на маркетплейс как товарный. Себестоимость берётся складская, а если позиции на складе не осталось — из карточки товара."}
      </p>
    </div>
  );
}
