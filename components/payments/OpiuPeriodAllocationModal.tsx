"use client";

import { CalendarRange, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatMoney, generateId } from "@/lib/format";
import {
  nextMonth,
  spreadOpiuPaymentEvenly,
  validateOpiuPaymentPeriodDrafts,
  type OpiuPaymentPeriodDraft,
} from "@/lib/opiu/paymentPeriodAllocations";
import type { Payment } from "@/lib/types";

interface DraftRow extends OpiuPaymentPeriodDraft { key: string }

const asRows = (rows: OpiuPaymentPeriodDraft[]): DraftRow[] => rows.map((row) => ({ ...row, key: generateId("opiu-month") }));

export function OpiuPeriodAllocationModal({ payment, onClose, onSaved }: {
  payment: Payment | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [original, setOriginal] = useState("[]");
  const [startMonth, setStartMonth] = useState("");
  const [monthCount, setMonthCount] = useState(2);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!payment) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setStartMonth(payment.date.slice(0, 7));
    fetch(`/api/finance/payments/${encodeURIComponent(payment.id)}/opiu-allocations`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { rows?: OpiuPaymentPeriodDraft[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить распределение");
        const loaded = body.rows ?? [];
        setRows(asRows(loaded));
        setOriginal(JSON.stringify(loaded));
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить распределение");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [payment]);

  const serialized = JSON.stringify(rows.map(({ month, amount }) => ({ month, amount })));
  const dirty = !loading && serialized !== original;
  const total = useMemo(() => Math.round(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100, [rows]);
  const expected = Math.abs(payment?.amount ?? 0);
  const difference = Math.round((expected - total) * 100) / 100;

  const requestClose = () => {
    if (dirty && !window.confirm("Закрыть окно без сохранения распределения?")) return;
    onClose();
  };

  const splitEvenly = () => {
    try {
      setRows(asRows(spreadOpiuPaymentEvenly(expected, startMonth, monthCount)));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось распределить сумму");
    }
  };

  const addMonth = () => {
    try {
      const month = rows.length ? nextMonth(rows[rows.length - 1].month) : startMonth;
      if (!month) throw new Error("Сначала выберите месяц");
      setRows((current) => [...current, {
        key: generateId("opiu-month"),
        month,
        amount: Math.max(0, Math.round((expected - total) * 100) / 100),
      }]);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось добавить месяц");
    }
  };

  const save = async (nextRows = rows.map(({ month, amount }) => ({ month, amount }))) => {
    if (!payment) return;
    setSaving(true);
    setError("");
    try {
      const validated = validateOpiuPaymentPeriodDrafts(payment.amount, nextRows);
      const response = await fetch(`/api/finance/payments/${encodeURIComponent(payment.id)}/opiu-allocations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validated }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить распределение");
      setOriginal(JSON.stringify(validated));
      onSaved?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить распределение");
    } finally {
      setSaving(false);
    }
  };

  return <Modal
    open={Boolean(payment)}
    onClose={requestClose}
    title="Распределение расхода по месяцам ОПиУ"
    size="lg"
    footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
      <button
        type="button"
        disabled={saving || loading || rows.length === 0}
        onClick={() => { if (window.confirm("Вернуть весь расход в месяц банковского платежа?")) void save([]); }}
        className="min-h-11 rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
      >По дате платежа</button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={requestClose} className="min-h-11 rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Отмена</button>
        <button
          type="button"
          disabled={saving || loading || !rows.length || difference !== 0}
          onClick={() => void save()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
        >{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </div>}
  >
    {!payment ? null : <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <CalendarRange className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-950">{payment.name}</p>
            <p className="mt-1 text-sm text-slate-600">Платёж {payment.date} · {formatMoney(Math.abs(payment.amount))} · {payment.category}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">В ДДС сумма останется на дате банка. Здесь задаются месяцы, в которых расход попадёт в ОПиУ.</p>
          </div>
        </div>
      </section>

      {loading ? <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Загружаю распределение…</div> : <>
        <section className="grid gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-4 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
          <label className="block text-sm font-medium text-slate-700">Первый месяц
            <input type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Месяцев
            <input type="number" min={1} max={120} value={monthCount} onChange={(event) => setMonthCount(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" />
          </label>
          <button type="button" onClick={splitEvenly} className="min-h-11 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50">Разделить поровну</button>
        </section>

        <div className="space-y-2">
          {!rows.length && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Распределения нет: весь расход относится к месяцу банковского платежа. Выберите период выше или добавьте строки вручную.</div>}
          {rows.map((row, index) => <div key={row.key} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_3rem] sm:items-end">
            <label className="block text-sm font-medium text-slate-700">Месяц {index + 1}
              <input type="month" value={row.month} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, month: event.target.value } : item))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <label className="block text-sm font-medium text-slate-700">Сумма
              <input type="number" inputMode="decimal" min="0.01" step="0.01" value={row.amount} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, amount: Number(event.target.value) } : item))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-right tabular-nums" />
            </label>
            <button type="button" aria-label={`Удалить месяц ${index + 1}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} className="tap rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
          </div>)}
          <button type="button" onClick={addMonth} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-violet-700 hover:bg-violet-50"><Plus className="h-4 w-4" />Добавить месяц</button>
        </div>

        <div aria-live="polite" className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm ${difference === 0 && rows.length ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          <span>Распределено: <b>{formatMoney(total)}</b> из {formatMoney(expected)}</span>
          <span>{difference > 0 ? `Осталось ${formatMoney(difference)}` : difference < 0 ? `Превышение ${formatMoney(-difference)}` : rows.length ? "Сумма сходится" : "По дате платежа"}</span>
        </div>
      </>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
    </div>}
  </Modal>;
}
