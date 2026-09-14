"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import type { OpeningBalanceVariantRow } from "@/app/api/warehouse/opening-balance/route";
import { newDocKey } from "@/lib/warehouse/docKey";

interface Line { variantId: string; qty: string; unitCost: string }
interface Posted { qty: number; amount: number; docNumber: string | null }

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;
const emptyLine = (): Line => ({ variantId: "", qty: "", unitCost: "" });

/**
 * Начальные остатки (§5.1): один ручной ввод на юрлицо, доступный только
 * пока у него нет вообще никакой истории движений — иначе это уже не «завести
 * с нуля», а искажение остатка задним числом. GET сам решает, показывать ли
 * форму: как только юрлицо получает первую проводку (пусть даже приёмкой из
 * заказа фабрике, а не отсюда), вкладка перестаёт предлагать её навсегда.
 */
export function OpeningBalanceTab({
  entityId,
  entityName,
  warehouses,
  canManage,
  onPosted,
}: {
  entityId: string;
  entityName: string;
  warehouses: WarehouseRow[];
  canManage: boolean;
  onPosted: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [variants, setVariants] = useState<OpeningBalanceVariantRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  // Отдельно от eligible: сразу после успешной проводки юрлицо перестаёт
  // быть eligible (у него уже есть история — та самая, что мы только что
  // завели), и если показывать результат через eligible, экран в тот же миг
  // переключился бы на «уже есть движения», а подтверждение того, что
  // человек только что сделал, ни разу не появилось бы на экране.
  const [posted, setPosted] = useState<Posted | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/opening-balance?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить");
      setEligible(Boolean(json.data?.eligible));
      setVariants(json.data?.variants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [entityId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);
  // Юрлицо сменили — предыдущий результат относится к другому юрлицу.
  useEffect(() => { setPosted(null); }, [entityId]);

  // Округляем количество здесь же, а не только на сервере: то, что человек
  // подтверждает в диалоге, обязано быть тем же числом, что реально уйдёт в
  // проводку — сервер всё равно округлит, но если делать это молча только
  // там, «Итого» на экране и сумма в проводке разойдутся на дробную часть.
  const validLines = useMemo(() => lines
    .map((line) => ({ variantId: line.variantId, qty: Math.round(Number(line.qty) || 0), unitCost: Number(line.unitCost) }))
    .filter((line) => line.variantId && line.qty > 0 && Number.isFinite(line.unitCost) && line.unitCost >= 0),
  [lines]);
  const total = validLines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
  const droppedLines = lines.filter((line) => line.variantId || line.qty || line.unitCost).length - validLines.length;

  const submit = async () => {
    if (validLines.length === 0) { setError("Добавьте позиции с количеством и себестоимостью"); return; }
    if (!warehouseId) { setError("Выберите склад"); return; }
    const confirmText = droppedLines > 0
      ? `${validLines.length} позиций на ${money(total)} — ${droppedLines} незаполненных строк будут пропущены. Завести начальный остаток для ${entityName}? Это разовое действие — второй раз для этого юрлица форма уже не откроется.`
      : `Завести начальный остаток для ${entityName}: ${validLines.length} позиций на ${money(total)}? Это разовое действие — второй раз для этого юрлица форма уже не откроется.`;
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/opening-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, warehouseId, note: note.trim() || undefined, lines: validLines, docKey: newDocKey() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось завести остаток");
      setPosted({ qty: Number(json.data.qty) || 0, amount: Number(json.data.amount) || 0, docNumber: json.data.docNumber ?? null });
      setLines([emptyLine()]);
      setNote("");
      onPosted();
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось завести остаток";
      setError(message);
      // Юрлицо успело получить историю откуда-то ещё, пока форма была
      // открыта — без перезагрузки формы человек бил бы в ту же ошибку
      // повторно, не понимая, что дело не в его вводе.
      if (message.includes("уже есть движения")) await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Загрузка…</div>;

  if (posted) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          Заведено: {formatNumber(posted.qty)} шт на {money(posted.amount)}{posted.docNumber ? ` · ${posted.docNumber}` : ""}. Документ — во вкладке «Документы».
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          У «{entityName}» теперь есть история движений — эта форма для него больше не откроется.
        </div>
      </div>
    );
  }

  if (!eligible) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        У «{entityName}» уже есть движения на складе — начальный остаток заводят один раз, для юрлица без истории вовсе. Если нужно поправить текущий остаток, это коррекция приёмки или списание, не эта форма.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        У «{entityName}» ещё нет ни одной проводки на складе. Здесь заводится стартовый остаток — один раз, вручную, с той себестоимостью, что укажете. После первого сохранения форма для этого юрлица больше не откроется.
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Нет прав на ведение остатка.</div>
      ) : (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700">
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий (необязательно)" className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300" />
          </div>

          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={line.variantId}
                  onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, variantId: e.target.value } : item))}
                  className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 sm:min-w-64 lg:min-h-0 lg:py-1.5"
                >
                  <option value="">выберите позицию</option>
                  {variants.map((row) => <option key={row.id} value={row.id}>{row.article} {row.sizeLabel}</option>)}
                </select>
                <input
                  type="number" min={1} step={1} value={line.qty} placeholder="кол-во"
                  onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, qty: e.target.value } : item))}
                  className="h-11 w-28 rounded-lg border border-slate-200 px-3 text-right text-sm text-slate-700 lg:h-9"
                />
                <input
                  type="number" min={0} step={0.01} value={line.unitCost} placeholder="себестоимость, ₽/шт"
                  onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unitCost: e.target.value } : item))}
                  className="h-11 w-40 rounded-lg border border-slate-200 px-3 text-right text-sm text-slate-700 lg:h-9"
                />
                <button
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  aria-label="Удалить позицию"
                  className="tap-hit rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                ><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => setLines([...lines, emptyLine()])} className="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:border-violet-300 lg:min-h-0 lg:py-1.5">
              <Plus className="h-4 w-4" /> Позиция
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">
                Итого: <span className="font-semibold text-slate-900">{money(total)}</span>
                {droppedLines > 0 ? <span className="ml-1.5 text-amber-600">· {droppedLines} строк без позиции/количества не войдут</span> : null}
              </span>
              <button
                onClick={() => void submit()}
                disabled={saving}
                className="flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 lg:min-h-0 lg:py-2"
              >
                {saving ? "Заводим…" : "Завести остаток"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
