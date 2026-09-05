"use client";

import { ClipboardList, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockBalanceRow, StockBalancesResponse } from "@/app/api/warehouse/balances/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import { operationalWarehouses, warehouseKindSuffix } from "@/lib/warehouse/warehouseKind";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { Hint } from "@/components/ui/Hint";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import { MARKETPLACE_LABEL } from "@/lib/warehouse/cabinetChannels";
import { newDocKey } from "@/lib/warehouse/docKey";
import { plural } from "@/lib/warehouse/plural";
import type { ShipmentTaskRow, TaskLineInput } from "@/lib/warehouse/tasks";
import { useDraft } from "@/lib/warehouse/useDraft";
import { DraftNotice } from "@/components/warehouse/DraftNotice";
import { TaskList } from "@/components/warehouse/TaskList";

interface CabinetOption {
  id: string;
  name: string;
  relation: "own" | "agent";
  marketplace: "wb" | "ozon";
}

type Mode = "task" | "now";

/** Резерв и доступное добавляет API-1 в /api/warehouse/balances; до этого
 *  полей нет, и доступно = остаток. */
type BalanceRow = StockBalanceRow & { reserved?: number; available?: number };
const reservedOf = (row: BalanceRow) => Math.max(0, Number(row.reserved ?? 0) || 0);
const availableOf = (row: BalanceRow) => (typeof row.available === "number" ? row.available : row.qty - reservedOf(row));

/** Ключ ячейки ввода: одна позиция может уехать в несколько кабинетов сразу. */
const cellKey = (variantId: string, cabinetId: string) => `${variantId}:${cabinetId}`;

interface ShipmentTabProps {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  refreshKey: number;
  onShipped: () => void;
  /** Кто смотрит: администратор и менеджер ставят задания и отгружают сами,
   *  оператор фулфилмента только выполняет. Передаёт WarehousePage
   *  (`canManageStock(me?.role)`); пока пропа нет — прав нет: спрятать форму
   *  у администратора безопаснее, чем показать её оператору. */
  canManage?: boolean;
}

export function ShipmentTab(props: ShipmentTabProps) {
  if (props.canManage !== true) {
    return <TaskList entityId={props.entityId} canManage={false} refreshKey={props.refreshKey} onShipped={props.onShipped} />;
  }
  return <ShipmentManager {...props} />;
}

/**
 * Экран администратора: матрица «размер × кабинет» в двух режимах.
 * «Задание для ФФ» (по умолчанию, ТЗ команды п. 4) — по документу на кабинет,
 * товар резервируется, отгружает фулфилмент. «Отгрузить сейчас» — прежнее
 * поведение, когда товар уже физически уехал (решение владельца 04.09).
 */
function ShipmentManager({ entityId, entity, warehouses, refreshKey, onShipped }: ShipmentTabProps) {
  const [mode, setMode] = useState<Mode>("task");
  const [balances, setBalances] = useState<StockBalancesResponse | null>(null);
  const [cabinets, setCabinets] = useState<CabinetOption[]>([]);
  // Отгружают с реального склада, а не из «В пути»: транзит — место для
  // перемещений, и его первое место в списке — случайность алфавита.
  const firstRealWarehouse = (list: WarehouseRow[]) => (list.find((row) => row.kind !== "transit") ?? list[0])?.id ?? "";
  const [warehouseId, setWarehouseId] = useState<string>(firstRealWarehouse(warehouses));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Создали задание — список ниже должен это увидеть, не дожидаясь «Обновить».
  const [tasksKey, setTasksKey] = useState(0);

  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) setWarehouseId(firstRealWarehouse(warehouses));
  }, [warehouses, warehouseId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const balancesRes = await fetch(`/api/warehouse/balances?entity=${entityId}`, { cache: "no-store" });
      const balancesJson = await balancesRes.json();
      if (!balancesRes.ok) throw new Error(balancesJson.error || "Не удалось загрузить остатки");
      setBalances(balancesJson.data);

      // Имена кабинетов приходят вместе с юрлицом — кабинетный API оператору склада закрыт.
      setCabinets((entity?.cabinets ?? []).map((link) => ({
        id: link.cabinetId,
        name: link.cabinetName,
        relation: link.relation,
        marketplace: link.marketplace,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [entityId, entity]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Юрлицо сменилось — введённое к нему больше не относится. Ячейки чужих
  // размеров в таблице не показываются, но продолжали бы считаться в итоге,
  // держать кнопку включённой и уезжать в черновик нового юрлица.
  useEffect(() => { setAmounts({}); setNote(""); }, [entityId, warehouseId]);

  // Ключ появляется, когда остатки уже пришли: до этого форма пустая не потому,
  // что её очистили, а потому что ей нечего показывать.
  // Ключ появляется, когда остатки пришли ПЕРВЫЙ раз, и дальше не исчезает:
  // на каждой перезагрузке `loading` снова становится true, а обнуление ключа
  // заставляет useDraft перечитать localStorage — и вернуть в форму ячейки
  // только что созданного задания. Повторное нажатие создало бы дубль.
  const balancesSeen = useRef(false);
  if (balances) balancesSeen.current = true;
  const draftKey = !balancesSeen.current || !warehouseId ? null : `warehouse:ship:${entityId}:${warehouseId}`;
  const draftValue = useMemo(() => ({ amounts, note }), [amounts, note]);
  const { restoredAt, forget } = useDraft(
    draftKey,
    draftValue,
    useCallback((value: { amounts: Record<string, string>; note: string }) =>
      Object.values(value.amounts).every((raw) => !raw) && !value.note, []),
    useCallback((value: { amounts: Record<string, string>; note: string }) => {
      setAmounts(value.amounts ?? {});
      setNote(value.note ?? "");
    }, []),
  );

  const startOver = () => { setAmounts({}); setNote(""); forget(); };

  const rows = useMemo(
    () => ((balances?.rows ?? []) as BalanceRow[]).filter((row) => row.warehouseId === warehouseId && row.qty > 0),
    [balances, warehouseId],
  );

  /** Введённое, разложенное по кабинетам — в режиме задания это и есть
   *  будущие документы: по одному на кабинет. */
  const byCabinet = useMemo(() => {
    const map = new Map<string, TaskLineInput[]>();
    for (const [key, raw] of Object.entries(amounts)) {
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const [variantId, cabinetId] = key.split(":");
      const list = map.get(cabinetId) ?? [];
      list.push({ variantId, qty });
      map.set(cabinetId, list);
    }
    return map;
  }, [amounts]);

  const totals = useMemo(() => {
    let qty = 0;
    let positions = 0;
    for (const lines of byCabinet.values()) {
      for (const line of lines) { qty += line.qty; positions += 1; }
    }
    return { qty, positions, cabinets: byCabinet.size };
  }, [byCabinet]);

  // Проверка идёт по «доступно», а не по остатку: чужое задание уже держит
  // свою часть, и отгрузить её второй раз нельзя.
  const overshoot = useMemo(() => {
    const used = new Map<string, number>();
    for (const lines of byCabinet.values()) {
      for (const line of lines) used.set(line.variantId, (used.get(line.variantId) ?? 0) + line.qty);
    }
    return rows.filter((row) => (used.get(row.variantId) ?? 0) > availableOf(row)).map((row) => row.variantId);
  }, [byCabinet, rows]);

  const cabinetName = (id: string) => cabinets.find((cabinet) => cabinet.id === id)?.name ?? "кабинет";

  const createTasks = async () => {
    if (byCabinet.size === 0) { setError("Укажите количества"); return; }
    setSaving(true);
    setError(null);
    setDone(null);
    const created: string[] = [];
    try {
      // Последовательно, а не разом: номера идут по порядку, а при ошибке на
      // втором кабинете первый уже создан и не создастся повторно.
      for (const [cabinetId, lines] of byCabinet) {
        const res = await fetch("/api/warehouse/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId, warehouseId, cabinetId, note, lines, docKey: newDocKey() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(`${cabinetName(cabinetId)}: ${json.error || "не удалось создать задание"}`);
        const task = json.data as ShipmentTaskRow;
        const qty = lines.reduce((sum, line) => sum + line.qty, 0);
        created.push(`${task.number} → ${cabinetName(cabinetId)} (${formatNumber(qty)} шт)`);
        // Ячейки этого кабинета очищаем сразу: если следующий кабинет упадёт,
        // повторное нажатие не создаст это задание второй раз.
        setAmounts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key.split(":")[1] !== cabinetId)));
      }
      setDone(
        (created.length === 1 ? "Создано задание" : `Создано ${created.length} ${plural(created.length, "задание", "задания", "заданий")}`)
        + `: ${created.join(", ")}. Фулфилмент увидит в списке ниже.`,
      );
      setNote("");
      forget();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось создать задание";
      setError(created.length > 0 ? `Создано: ${created.join(", ")}. Дальше не вышло — ${message}` : message);
    } finally {
      setSaving(false);
      if (created.length > 0) {
        setTasksKey((key) => key + 1);
        await load();
      }
    }
  };

  const shipNow = async () => {
    const lines = Object.entries(amounts)
      .map(([key, raw]) => {
        const [variantId, cabinetId] = key.split(":");
        return { variantId, cabinetId, qty: Number(raw) };
      })
      .filter((line) => Number.isFinite(line.qty) && line.qty > 0);

    if (lines.length === 0) { setError("Укажите количества"); return; }
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/warehouse/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, warehouseId, note, lines, docKey: newDocKey() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось отгрузить");
      // Накладных столько, сколько кабинетов: человек должен знать, сколько
      // бумаг печатать и какая куда.
      const papers = (json.data.docs ?? []) as { number: string; cabinetId: string; qty: number }[];
      const named = papers
        .map((doc) => `${doc.number} → ${cabinetName(doc.cabinetId)} (${formatNumber(doc.qty)} шт)`)
        .join(", ");
      setDone(
        `Отгружено ${formatNumber(json.data.qty)} шт на ${formatNumber(Math.round(json.data.amount))} ₽`
        + (named ? `. Накладные: ${named}` : ""),
      );
      setAmounts({});
      setNote("");
      forget();
      setTasksKey((key) => key + 1);
      await load();
      onShipped();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отгрузить");
    } finally {
      setSaving(false);
    }
  };

  const taskList = (
    <TaskList
      entityId={entityId}
      canManage
      refreshKey={`${refreshKey}:${tasksKey}`}
      onShipped={() => { void load(); onShipped(); }}
      onChanged={() => { void load(); }}
    />
  );

  if (loading && !balances) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю остатки…</div>;
  }

  if (cabinets.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          У юрлица «{entity?.name}» нет связанных кабинетов — отгружать некуда. Свяжите кабинет с юрлицом,
          и он появится здесь колонкой.
        </div>
        {taskList}
      </div>
    );
  }

  const submitLabel = mode === "task"
    ? (saving
      ? "Создаю…"
      : totals.cabinets > 1 ? `Создать ${totals.cabinets} ${plural(totals.cabinets, "задание", "задания", "заданий")}` : "Создать задание")
    : (saving ? "Отгружаю…" : "Отгрузить");

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{done}</div>}
      <DraftNotice at={restoredAt} onForget={startOver} />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex gap-1 overflow-x-auto overscroll-x-contain rounded-lg bg-slate-100 p-1 sm:w-fit">
          {([["task", "Задание для ФФ", ClipboardList], ["now", "Отгрузить сейчас", Truck]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => { setMode(key); setDone(null); setError(null); }}
              title={key === "task"
                ? "Товар резервируется; списывается, когда фулфилмент нажмёт «Отгружено»"
                : "Списать сразу — товар уже физически уехал"}
              className={`flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm transition-colors lg:min-h-0 lg:py-1.5 ${
                mode === key ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        {/* Разница между режимами — резерв или списание прямо сейчас — жила в
            `title` самих вкладок: на касании её не было, а цена ошибки — товар,
            снятый с остатка раньше времени. Значок стоит рядом с переключателем
            и объясняет оба режима разом. */}
        <Hint label="Чем «Задание для ФФ» отличается от «Отгрузить сейчас»">
          Задание для ФФ: товар резервируется, а списывается, когда фулфилмент нажмёт «Отгружено».
          Отгрузить сейчас: списать сразу — товар уже физически уехал.
        </Hint>
        <span className="text-sm text-slate-500">со склада</span>
        <select
          value={warehouseId}
          onChange={(e) => { setWarehouseId(e.target.value); setAmounts({}); }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {operationalWarehouses(warehouses, warehouseId).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}{warehouseKindSuffix(warehouse.kind)}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={mode === "task" ? "Комментарий для фулфилмента" : "Комментарий к отгрузке"}
          className="min-w-48 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">На складе пусто</p>
          <p className="mt-1 text-sm text-slate-400">Отгружать нечего: сначала проведите приёмку.</p>
        </div>
      ) : (
        <>
          {/* Смысл двух колонок раньше жил только в подсказке по наведению —
              на касании её нет вовсе. Пишем текстом. */}
          <p className="text-xs text-slate-400">
            «В заданиях» — размещено в заданиях, которые ещё не отгружены.
            «Доступно» — остаток минус то, что держат задания.
          </p>

          {/* Колонок столько, сколько кабинетов, — таблица заведомо шире экрана.
              Артикул закреплён слева: без него ввод количества в третий кабинет
              идёт вслепую, а ошибка здесь — товар, уехавший не на ту площадку. */}
          <div className="scroll-x rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                  <th className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50 px-4 py-3 text-left font-medium">Артикул</th>
                  <th className="px-4 py-3 text-right font-medium">На складе</th>
                  <th className="px-4 py-3 text-right font-medium text-red-600">В заданиях</th>
                  <th className="px-4 py-3 text-right font-medium">Доступно</th>
                  {cabinets.map((cabinet) => (
                    <th key={cabinet.id} className="px-4 py-3 text-right font-medium">
                      {cabinet.name}
                      {/* Маркетплейс виден в шапке колонки: у кабинетов бывают похожие
                          имена, а отгрузка не туда — это товар, уехавший не на ту площадку. */}
                      <span className={`ml-1 rounded px-1 py-0.5 text-[10px] normal-case ${
                        cabinet.marketplace === "ozon" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"
                      }`}>{MARKETPLACE_LABEL[cabinet.marketplace]}</span>
                      {cabinet.relation === "agent" && (
                        <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[10px] normal-case text-slate-600">агент</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tooMuch = overshoot.includes(row.variantId);
                  const reserved = reservedOf(row);
                  const available = availableOf(row);
                  return (
                    <tr key={row.variantId} className="border-b border-slate-100 last:border-0">
                      <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <WbProductImage
                            nm={row.nmId ?? undefined}
                            src={row.photoUrl ?? undefined}
                            alt={row.article}
                            label={row.article}
                            className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                          />
                          <div>
                            <div className="font-medium text-slate-900">{variantLabel(row.article, row.sizeLabel)}</div>
                            <div className="text-xs text-slate-400">{row.unitCost.toFixed(2)} ₽/шт</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(row.qty)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${reserved > 0 ? "font-medium text-red-600" : "text-slate-300"}`}>
                        {reserved > 0 ? formatNumber(reserved) : ""}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${tooMuch ? "text-red-600" : "text-slate-900"}`}>
                        {formatNumber(available)}
                      </td>
                      {cabinets.map((cabinet) => (
                        <td key={cabinet.id} className="px-4 py-2.5 text-right">
                          <input
                            inputMode="numeric"
                            value={amounts[cellKey(row.variantId, cabinet.id)] ?? ""}
                            onChange={(e) => setAmounts((prev) => ({
                              ...prev,
                              [cellKey(row.variantId, cabinet.id)]: e.target.value.replace(/[^\d]/g, ""),
                            }))}
                            placeholder="0"
                            className={`min-h-11 w-20 rounded-lg border px-2 py-1 text-right text-sm lg:min-h-0 ${
                              tooMuch ? "border-red-300 bg-red-50" : "border-slate-200"
                            }`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">
              К отгрузке <b className="text-slate-900">{formatNumber(totals.qty)}</b> шт
              <span className="text-slate-400"> · {totals.positions} {plural(totals.positions, "строка", "строки", "строк")}</span>
              {mode === "task" && totals.cabinets > 1 && (
                <span className="text-slate-400"> · {totals.cabinets} {plural(totals.cabinets, "задание", "задания", "заданий")}, по одному на кабинет</span>
              )}
              {overshoot.length > 0 && (
                <span className="ml-2 text-red-600">больше доступного — исправьте выделенное</span>
              )}
            </div>
            <button
              onClick={() => void (mode === "task" ? createTasks() : shipNow())}
              disabled={saving || totals.qty === 0 || overshoot.length > 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </div>
        </>
      )}

      {taskList}
    </div>
  );
}
