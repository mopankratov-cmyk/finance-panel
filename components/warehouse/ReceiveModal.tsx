"use client";

import { Check, ScanLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import { Modal } from "@/components/ui/Modal";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { DraftNotice } from "@/components/warehouse/DraftNotice";
import { plural } from "@/lib/warehouse/plural";
import { useDraft } from "@/lib/warehouse/useDraft";
import type { ReceiptLineRow } from "@/app/api/warehouse/receipts/route";

interface Draft { received: string; defect: string }

/** Пересчёт партии фулфилментом: сколько пришло и сколько из этого брак —
 *  одной операцией, как оператор и сообщает это по факту разгрузки. Колонка
 *  «Ждём» только для чтения: первоначальное количество ФФ не меняет (п. 1 ТЗ),
 *  его правит админ через коррекцию прихода.
 *
 *  Два способа считать, и они не смешиваются. По умолчанию количества
 *  подставлены из ожидаемых: расхождение — исключение, и правят его руками.
 *  Сканером считают с нуля: каждый штрихкод прибавляет единицу, и подставленные
 *  ожидания тут только мешали бы — «принято 10» превратилось бы в 11 с первого
 *  же пикнувшего товара. Поэтому режим включают явной кнопкой, а не первым
 *  сканом. */
export function ReceiveModal({
  batchId,
  number,
  entityId,
  warehouseId,
  warehouseName,
  onClose,
  onDone,
}: {
  batchId: string;
  /** Номер партии из шапки (ПРМ-2026-…); до миграции его нет. */
  number?: string | null;
  entityId: string;
  warehouseId: string;
  warehouseName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<ReceiptLineRow[]>([]);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [defaults, setDefaults] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"save" | "post" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState("");
  const [scanNote, setScanNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Роут проверяет доступ к юрлицу до того, как смотрит на партию: без
      // entity он отвечает «Выберите юрлицо», и окно пересчёта пустое.
      const res = await fetch(`/api/warehouse/receipts?entity=${encodeURIComponent(entityId)}&batch=${batchId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить позиции");
      const rows: ReceiptLineRow[] = json.data ?? [];
      setLines(rows);
      const fresh = Object.fromEntries(rows.map((row) => [row.id, {
        received: String(row.receivedQty ?? row.expectedQty),
        defect: String(row.defectQty || ""),
      }]));
      setDraft(fresh);
      setDefaults(JSON.stringify(fresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить позиции");
    } finally {
      setLoading(false);
    }
  }, [batchId, entityId]);

  useEffect(() => { void load(); }, [load]);

  // Черновик держится за партией, а не за окном: закрыли модалку случайно —
  // открыли снова и продолжили пересчёт с того же места.
  const { restoredAt, forget } = useDraft(
    loading ? null : `warehouse:receive:${batchId}`,
    draft,
    useCallback((value: Record<number, Draft>) => JSON.stringify(value) === defaults, [defaults]),
    useCallback((value: Record<number, Draft>) => setDraft(value), []),
  );

  const pending = useMemo(() => lines.filter((line) => line.status === "expected"), [lines]);

  /** Модели с их размерами: у одной куртки четыре строки приёмки, и показывать
   *  их четырьмя карточками с одинаковым фото — читать глазами по диагонали. */
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; article: string; nmId: number | null; photoUrl: string | null; rows: ReceiptLineRow[] }>();
    for (const line of pending) {
      const key = line.productId ?? `nm:${line.nmId ?? line.article}`;
      const group = map.get(key) ?? { key, article: line.article, nmId: line.nmId, photoUrl: line.photoUrl, rows: [] };
      group.rows.push(line);
      map.set(key, group);
    }
    return [...map.values()];
  }, [pending]);

  const totals = useMemo(() => {
    let expected = 0;
    let received = 0;
    let defect = 0;
    for (const line of pending) {
      expected += line.expectedQty;
      received += Number(draft[line.id]?.received || 0);
      defect += Number(draft[line.id]?.defect || 0);
    }
    return { expected, received, defect, gap: received - expected };
  }, [pending, draft]);

  const badDefect = pending.some((line) => Number(draft[line.id]?.defect || 0) > Number(draft[line.id]?.received || 0));

  const setValue = (id: number, patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { received: "", defect: "" }), ...patch } }));

  const startScanning = () => {
    // Счёт сканером идёт с нуля — иначе первый же товар добавится к ожиданию.
    // Но обнулять молча нельзя: выход «Ввести руками» и возврат в сканирование —
    // это два клика, и между ними человек успевает вбить половину партии. Раньше
    // она исчезала без вопроса и через 400 мс затирала черновик.
    const entered = pending.some((line) => Number(draft[line.id]?.received || 0) > 0);
    if (entered && !window.confirm(
      "Счёт сканером начинается с нуля — введённые количества обнулятся.\n\nПродолжить?",
    )) return;
    setDraft(Object.fromEntries(pending.map((line) => [line.id, { received: "0", defect: draft[line.id]?.defect ?? "" }])));
    setScanning(true);
    setScanNote(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  const stopScanning = () => {
    setScanning(false);
    setScan("");
    setScanNote(null);
  };

  const applyScan = (raw: string) => {
    const code = raw.trim();
    setScan("");
    if (!code) return;
    const line = pending.find((row) => row.barcode && row.barcode === code);
    if (!line) {
      setScanNote({ tone: "bad", text: `Штрихкод ${code} — не из этой партии` });
      return;
    }
    const next = Number(draft[line.id]?.received || 0) + 1;
    setValue(line.id, { received: String(next) });
    setFlash(line.id);
    setScanNote({
      tone: "ok",
      text: `${line.article}${line.sizeLabel ? ` · ${line.sizeLabel}` : ""} → ${next}${next > line.expectedQty ? " (больше ожидаемого)" : ""}`,
    });
    setTimeout(() => setFlash((current) => (current === line.id ? null : current)), 700);
  };

  const submit = async (post: boolean) => {
    setSaving(post ? "post" : "save");
    setError(null);
    try {
      const payload = pending.map((line) => ({
        id: line.id,
        receivedQty: Number(draft[line.id]?.received || 0),
        defectQty: Number(draft[line.id]?.defect || 0),
      }));
      const res = await fetch("/api/warehouse/receipts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, batchId, lines: payload, post, warehouseId: post ? warehouseId : undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось сохранить приём");
      // Проводка могла не состояться при сохранённом факте — тогда сервер вернул
      // текст ошибки вместе с успехом, и глотать его нельзя.
      if (json.error) { setError(json.error); forget(); await load(); return; }
      // Часть строк посчитал кто-то раньше. Сохранилось не всё, что человек
      // вводил, — закрыть окно с видом успеха значит соврать. Оставляем его
      // открытым с предупреждением и перечитываем партию.
      const skipped = Number(json.data?.skipped ?? 0);
      if (skipped > 0) {
        setError(`${skipped} ${plural(skipped, "позицию", "позиции", "позиций")} уже посчитали до вас — ваши количества по ним не сохранены.`
          + " Проверьте партию; при расхождении оформите коррекцию прихода.");
        forget();
        await load();
        return;
      }
      forget();
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить приём");
    } finally {
      setSaving(null);
    }
  };

  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      {pending.length > 0 && (
        <div className="text-sm text-slate-500">
          Ждём {formatNumber(totals.expected)} · принято{" "}
          <span className="font-semibold text-slate-900">{formatNumber(totals.received)}</span>
          {totals.gap !== 0 && (
            <span className={totals.gap < 0 ? "text-amber-600" : "text-sky-600"}>
              {" "}({totals.gap < 0 ? "недовоз " : "излишек "}{formatNumber(Math.abs(totals.gap))})
            </span>
          )}
          {totals.defect > 0 && <span className="text-red-600"> · брак {formatNumber(totals.defect)}</span>}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-4 text-sm text-slate-600 lg:min-h-0 lg:py-2"
        >
          Отмена
        </button>
        <button
          onClick={() => void submit(false)}
          disabled={saving !== null || pending.length === 0 || badDefect}
          className="inline-flex min-h-11 items-center rounded-lg border border-violet-200 px-4 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 lg:min-h-0 lg:py-2"
        >
          {saving === "save" ? "Сохраняю…" : "Только отметить"}
        </button>
        <button
          onClick={() => void submit(true)}
          disabled={saving !== null || pending.length === 0 || badDefect || !warehouseId}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 lg:min-h-0 lg:py-2"
        >
          <Check className="h-4 w-4" />
          {saving === "post" ? "Ставлю…" : "Пересчитано — на остаток"}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Пересчёт партии${number ? ` ${number}` : ""}`}
      size="xl"
      footer={footer}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">На склад «{warehouseName}»</p>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {restoredAt !== null && <DraftNotice at={restoredAt} onForget={() => { forget(); void load(); }} />}

        {loading ? (
          <div className="py-10 text-center text-sm text-slate-400">Загружаю позиции…</div>
        ) : pending.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-slate-700">Все позиции уже пересчитаны</p>
            <p className="mt-1 text-sm text-slate-400">Осталось поставить партию на остаток.</p>
          </div>
        ) : (
          <>
            {/* Поле сканера прилипает к верху: считают его не глядя на экран, и
                уехавшая под прокрутку строка ввода означала бы потерянные пики. */}
            <div className="sticky top-0 z-10 -mx-4 border-b border-slate-100 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
              {scanning ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ScanLine className="h-4 w-4 shrink-0 text-violet-500" />
                    <input
                      ref={scanRef}
                      value={scan}
                      onChange={(e) => setScan(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyScan(scan); } }}
                      placeholder="Сканируйте штрихкод"
                      className="min-h-11 min-w-40 flex-1 rounded-lg border border-violet-300 px-3 text-sm outline-none focus:border-violet-500 lg:min-h-0 lg:py-2"
                    />
                    <button
                      onClick={stopScanning}
                      className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 lg:min-h-0 lg:py-2"
                    >
                      Ввести руками
                    </button>
                  </div>
                  {scanNote && (
                    <p className={`text-sm ${scanNote.tone === "ok" ? "text-emerald-700" : "text-red-600"}`}>{scanNote.text}</p>
                  )}
                </div>
              ) : (
                <button
                  onClick={startScanning}
                  className="inline-flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50 lg:min-h-0 lg:py-2"
                >
                  <ScanLine className="h-4 w-4" />
                  Считать сканером
                  <span className="text-xs text-slate-400">количества обнулятся</span>
                </button>
              )}
            </div>

            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.key} className="md:rounded-xl md:border md:border-slate-200">
                  <div className="flex items-center gap-2.5 border-b border-slate-100 px-0 py-2.5 md:px-3">
                    <WbProductImage
                      nm={group.nmId ?? undefined}
                      src={group.photoUrl ?? undefined}
                      alt={group.article}
                      label={group.article}
                      className="h-9 w-9 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                    />
                    <span className="break-anywhere font-medium text-slate-900">{group.article || group.nmId}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">
                      {group.rows.length > 1 ? `${group.rows.length} размера` : ""}
                    </span>
                  </div>
                  {/* Четыре колонки с двумя полями ввода в 320 px не помещаются
                      никак: на телефоне размер становится заголовком карточки,
                      а «Принято» и «Из них брак» — двумя строками под ним. */}
                  <div className="table-cards scroll-x pt-2 md:pt-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-3 pb-1 pt-2 text-left font-medium">Размер</th>
                          <th className="px-3 pb-1 pt-2 text-right font-medium">Ждём</th>
                          <th className="px-3 pb-1 pt-2 text-right font-medium">Принято</th>
                          <th className="px-3 pb-1 pt-2 text-right font-medium">Из них брак</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((line) => {
                          const value = draft[line.id] ?? { received: "", defect: "" };
                          const received = Number(value.received || 0);
                          const tooMuchDefect = Number(value.defect || 0) > received;
                          const short = received < line.expectedQty;
                          const over = received > line.expectedQty;
                          return (
                            <tr key={line.id} className={`border-t border-slate-100 transition-colors ${flash === line.id ? "bg-emerald-50" : ""}`}>
                              <td data-cell="title" className="px-3 py-2 text-slate-700">
                                {line.sizeLabel || <span className="text-slate-300">без размера</span>}
                                {!line.barcode && scanning && (
                                  <span className="ml-1.5 text-xs text-amber-600">нет штрихкода</span>
                                )}
                              </td>
                              <td data-label="Ждём" className="px-3 py-2 text-right text-slate-500">{formatNumber(line.expectedQty)}</td>
                              <td data-label="Принято" className="px-3 py-2 text-right">
                                <input
                                  inputMode="numeric"
                                  value={value.received}
                                  onChange={(e) => setValue(line.id, { received: e.target.value.replace(/[^\d]/g, "") })}
                                  className={`min-h-11 w-24 rounded-lg border px-2 py-1 text-right lg:min-h-0 ${
                                    over ? "border-sky-300 bg-sky-50" : short ? "border-amber-300 bg-amber-50" : "border-slate-200"
                                  }`}
                                />
                              </td>
                              <td data-label="Из них брак" className="px-3 py-2 text-right">
                                <input
                                  inputMode="numeric"
                                  value={value.defect}
                                  onChange={(e) => setValue(line.id, { defect: e.target.value.replace(/[^\d]/g, "") })}
                                  placeholder="0"
                                  className={`min-h-11 w-24 rounded-lg border px-2 py-1 text-right placeholder:text-slate-300 lg:min-h-0 ${
                                    tooMuchDefect ? "border-red-300 bg-red-50" : "border-slate-200"
                                  }`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
