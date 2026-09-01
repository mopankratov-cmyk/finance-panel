"use client";

import { FileSpreadsheet, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { readFirstSheetXlsx } from "@/components/payments/bankStatement";
import { parseCsv, parseRussianAmount, parseRussianDate } from "@/components/payments/ddsCsv";
import { Modal } from "@/components/ui/Modal";
import { PAYMENT_CATEGORIES } from "@/lib/constants";
import { generateId } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";
import { PRIORITY_META, setPaymentPriorityComment, suggestPaymentPriority, type PaymentPriority } from "./paymentPriority";

interface DraftRow {
  id: string;
  date: string;
  flow: "expense" | "income";
  amount: string;
  name: string;
  category: string;
  accountId: string;
  counterparty: string;
  status: "planned" | "done";
  priority: PaymentPriority;
}

const emptyRow = (accounts: Account[], flow: "expense" | "income"): DraftRow => ({
  id: generateId("draft"),
  date: new Date().toISOString().slice(0, 10),
  flow,
  amount: "",
  name: "",
  category: flow === "income" ? "Продажи на МП" : "",
  accountId: accounts[0]?.id ?? "",
  counterparty: "",
  status: "planned",
  priority: flow === "income" ? suggestPaymentPriority("Продажи на МП") : "C",
});

const normalized = (value: string) => value.trim().toLowerCase().replace(/ё/g, "е");

function findColumn(header: string[], names: string[]) {
  return header.findIndex((cell) => names.includes(normalized(cell)));
}

function excelDate(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 20_000 && numeric < 100_000) {
    const date = new Date(Date.UTC(1899, 11, 30 + numeric));
    return date.toISOString().slice(0, 10);
  }
  return parseRussianDate(value) ?? (/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : "");
}

export function BulkPaymentModal({
  open,
  onClose,
  initialFlow,
  accounts,
  existingPayments,
  onAddMany,
}: {
  open: boolean;
  onClose: () => void;
  initialFlow: "expense" | "income";
  accounts: Account[];
  existingPayments: Payment[];
  onAddMany: (payments: Payment[]) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const activeRows = rows.length ? rows : [emptyRow(accounts, initialFlow)];
  const accountByName = useMemo(() => new Map(accounts.map((account) => [normalized(account.name), account.id])), [accounts]);

  const update = (id: string, patch: Partial<DraftRow>) =>
    setRows((current) => (current.length ? current : activeRows).map((row) => row.id === id ? { ...row, ...patch } : row));

  const parseFile = async (file: File) => {
    try {
      const matrix = file.name.toLowerCase().endsWith(".xlsx")
        ? await readFirstSheetXlsx(file)
        : parseCsv(await file.text());
      const headerIndex = matrix.findIndex((row) => findColumn(row, ["дата"]) >= 0 && findColumn(row, ["сумма"]) >= 0);
      if (headerIndex < 0) throw new Error("Не найдены обязательные колонки «Дата» и «Сумма»");
      const header = matrix[headerIndex];
      const columns = {
        date: findColumn(header, ["дата"]),
        amount: findColumn(header, ["сумма"]),
        flow: findColumn(header, ["тип", "операция", "приход/расход"]),
        name: findColumn(header, ["назначение платежа", "назначение", "комментарий"]),
        category: findColumn(header, ["название", "статья", "категория"]),
        wallet: findColumn(header, ["кошелек", "кошелёк", "счет", "счёт"]),
        counterparty: findColumn(header, ["контрагент"]),
        status: findColumn(header, ["статус"]),
        priority: findColumn(header, ["приоритет", "категория приоритета"]),
      };
      const imported: DraftRow[] = [];
      for (const source of matrix.slice(headerIndex + 1)) {
        const date = excelDate(source[columns.date] ?? "");
        const rawAmount = parseRussianAmount(source[columns.amount] ?? "");
        if (!date || rawAmount === null || rawAmount === 0) continue;
        const flowText = normalized(source[columns.flow] ?? "");
        const flow = rawAmount < 0 || flowText.includes("расход") || flowText.includes("выбыт") ? "expense" : "income";
        const wallet = normalized(source[columns.wallet] ?? "");
        imported.push({
          id: generateId("draft"),
          date,
          flow,
          amount: String(Math.abs(rawAmount)),
          name: source[columns.name]?.trim() || source[columns.category]?.trim() || "Платёж",
          category: source[columns.category]?.trim() || (flow === "income" ? "Продажи на МП" : "Прочее"),
          accountId: accountByName.get(wallet) ?? accounts[0]?.id ?? "",
          counterparty: source[columns.counterparty]?.trim() || "",
          status: normalized(source[columns.status] ?? "").includes("факт") ? "done" : "planned",
          priority: (["A", "B", "C"].includes((source[columns.priority] ?? "").trim().toUpperCase())
            ? (source[columns.priority] ?? "").trim().toUpperCase()
            : suggestPaymentPriority(source[columns.category]?.trim(), source[columns.name]?.trim())) as PaymentPriority,
        });
      }
      if (!imported.length) throw new Error("В файле не найдено подходящих строк");
      setRows(imported);
      setError("");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Не удалось прочитать файл");
    }
  };

  const downloadTemplate = () => {
    const sample = [
      ["Дата", "Тип", "Сумма", "Название", "Назначение платежа", "Кошелёк", "Контрагент", "Статус", "Приоритет"],
      ["01.08.2026", initialFlow === "expense" ? "Расход" : "Поступление", "10000", initialFlow === "expense" ? "Прочее" : "Продажи на МП", "Пример назначения или комментария", accounts[0]?.name ?? "", "", "План", "B"],
    ];
    const csv = sample.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = "шаблон_платежного_календаря.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const save = () => {
    const invalid = activeRows.find((row) => !row.date || !Number(row.amount) || !row.name.trim() || !row.accountId);
    if (invalid) {
      setError("Заполните дату, сумму, название и кошелёк во всех строках");
      return;
    }
    const duplicates: string[] = [];
    const payments = activeRows.map((row) => {
      const amount = Math.abs(Number(row.amount)) * (row.flow === "expense" ? -1 : 1);
      const duplicate = existingPayments.some((payment) =>
        payment.date === row.date &&
        Math.abs(payment.amount - amount) < 0.01 &&
        payment.accountId === row.accountId &&
        normalized(payment.name) === normalized(row.name),
      );
      if (duplicate) duplicates.push(`${row.date} · ${row.name}`);
      return {
        id: generateId("pay"),
        date: row.date,
        amount,
        name: row.name.trim(),
        category: row.category,
        accountId: row.accountId,
        counterparty: row.counterparty.trim(),
        status: row.status,
        comment: setPaymentPriorityComment(undefined, row.priority),
      } satisfies Payment;
    });
    if (duplicates.length && !confirm(`Найдено похожих платежей: ${duplicates.length}. Всё равно добавить?`)) return;
    onAddMany(payments);
    setRows([]);
    setError("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Добавить платежи списком">
      <div className="space-y-4">
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
          <p className="font-semibold text-violet-950">Можно заполнить строки здесь или загрузить файл</p>
          <p className="mt-1 text-sm text-violet-800">CSV/XLSX: обязательные колонки «Дата» и «Сумма». «Название» — финансовая статья, «Назначение платежа» — текст операции из выписки или ваш собственный текст.</p>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(event) => event.target.files?.[0] && void parseFile(event.target.files[0])} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-violet-700 shadow-sm"><Upload className="h-4 w-4" /> Загрузить CSV или XLSX</button>
            <button onClick={downloadTemplate} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-200 px-4 text-sm font-semibold text-violet-700"><FileSpreadsheet className="h-4 w-4" /> Скачать шаблон</button>
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
          {activeRows.map((row, index) => (
            <div key={row.id} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-slate-700">Строка {index + 1}</span><button onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} aria-label="Удалить строку" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input type="date" value={row.date} onChange={(event) => update(row.id, { date: event.target.value })} className="min-h-11 rounded-lg border border-slate-300 px-3" />
                <div className="grid grid-cols-2 gap-2"><select value={row.flow} onChange={(event) => {
                  const flow = event.target.value as DraftRow["flow"];
                  update(row.id, { flow, category: flow === "expense" ? "" : "Продажи на МП", priority: flow === "expense" ? "C" : suggestPaymentPriority("Продажи на МП") });
                }} className="min-h-11 rounded-lg border border-slate-300 px-2"><option value="expense">Расход</option><option value="income">Поступление</option></select><input type="number" min="0" step="0.01" value={row.amount} onChange={(event) => update(row.id, { amount: event.target.value })} placeholder="Сумма" className="min-h-11 rounded-lg border border-slate-300 px-3" /></div>
                <input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} placeholder="Назначение платежа" className="min-h-11 rounded-lg border border-slate-300 px-3" />
                <select required value={row.category} onChange={(event) => update(row.id, { category: event.target.value })} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="" disabled>Выберите статью</option>{PAYMENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select>
                <select value={row.accountId} onChange={(event) => update(row.id, { accountId: event.target.value })} className="min-h-11 rounded-lg border border-slate-300 px-3">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
                <input value={row.counterparty} onChange={(event) => update(row.id, { counterparty: event.target.value })} placeholder="Контрагент" className="min-h-11 rounded-lg border border-slate-300 px-3" />
                <select value={row.status} onChange={(event) => update(row.id, { status: event.target.value as DraftRow["status"] })} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="planned">План</option><option value="done">Факт</option></select>
                <select value={row.priority} onChange={(event) => update(row.id, { priority: event.target.value as PaymentPriority })} className="min-h-11 rounded-lg border border-slate-300 px-3">{(Object.keys(PRIORITY_META) as PaymentPriority[]).map((priority) => <option key={priority} value={priority}>{PRIORITY_META[priority].label}</option>)}</select>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-between">
          <button onClick={() => setRows((current) => [...(current.length ? current : activeRows), emptyRow(accounts, initialFlow)])} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700"><Plus className="h-4 w-4" /> Добавить строку</button>
          <button onClick={save} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white"><FileSpreadsheet className="h-4 w-4" /> Сохранить {activeRows.length}</button>
        </div>
      </div>
    </Modal>
  );
}
