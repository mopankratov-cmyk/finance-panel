"use client";

import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { DdsReport } from "./DdsReport";
import { cleanDemoData } from "./ddsImport";
import { ImportDdsModal } from "./ImportDdsModal";
import { PaymentForm } from "./PaymentForm";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PAYMENT_CATEGORIES } from "@/lib/constants";
import { formatDate, formatMoney, generateId } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function PaymentsPage() {
  const { state, dispatch } = useFinance();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [mode, setMode] = useState<"ledger" | "dds">("ledger");
  const [importOpen, setImportOpen] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAccount, setFilterAccount] = useState("");

  const filtered = useMemo(() => {
    return state.payments
      .filter((p) => {
        if (p.status !== "done") return false; // реестр — только факт; план — в платёжном календаре
        if (dateFrom && p.date < dateFrom) return false;
        if (dateTo && p.date > dateTo) return false;
        if (filterCategory && p.category !== filterCategory) return false;
        if (filterAccount && p.accountId !== filterAccount) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [state.payments, dateFrom, dateTo, filterCategory, filterAccount]);

  const getAccountName = (id: string) =>
    state.accounts.find((a) => a.id === id)?.name ?? "—";

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (payment: Payment) => {
    setEditing(payment);
    setModalOpen(true);
  };

  const handleSubmit = (data: Omit<Payment, "id">) => {
    if (editing) {
      dispatch({ type: "UPDATE_PAYMENT", payload: { ...editing, ...data } });
    } else {
      dispatch({
        type: "ADD_PAYMENT",
        payload: { id: generateId("pay"), ...data },
      });
    }
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить этот платёж?")) {
      dispatch({ type: "DELETE_PAYMENT", payload: id });
    }
  };

  const handleCleanDemo = async () => {
    if (
      !confirm(
        "Удалить стартовые демо-данные (счета «WB Счёт 1/2», «Ozon», «Банковский счёт», «Наличные» и их платежи)?\n\nЗагруженное из файла не тронется. Действие необратимо.",
      )
    )
      return;
    try {
      const r = await cleanDemoData();
      alert(`Удалено счетов: ${r.accountsDeleted}, платежей: ${r.paymentsDeleted}. Страница обновится.`);
      window.location.reload();
    } catch (e) {
      alert(`Ошибка: ${e instanceof Error ? e.message : "не удалось удалить"}`);
    }
  };

  // уникальные контрагенты — для подсказок в форме
  const counterparties = useMemo(
    () =>
      Array.from(new Set(state.payments.map((p) => p.counterparty).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "ru"),
      ),
    [state.payments],
  );


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Платежи</h1>
          <p className="text-sm text-slate-400 mt-1">
            {mode === "ledger" ? "Реестр платежей и поступлений" : "Свод движения денежных средств"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {(["ledger", "dds"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === m ? "bg-white text-violet-700 shadow" : "text-slate-500"
                }`}
              >
                {m === "ledger" ? "Реестр" : "Свод ДДС"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Импорт ДДС
          </button>
          <button
            onClick={handleCleanDemo}
            title="Удалить стартовые демо-данные"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Удалить демо
          </button>
          {mode === "ledger" && (
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Новый платёж
            </button>
          )}
        </div>
      </div>

      {mode === "dds" && <DdsReport payments={state.payments} />}

      {mode === "ledger" && (
        <>
      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">С даты</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">По дату</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Статья
              </label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                {PAYMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Кошелёк</label>
              <select
                value={filterAccount}
                onChange={(e) => setFilterAccount(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                {state.accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium text-right">Сумма</th>
                <th className="px-5 py-3 font-medium">Кошелек</th>
                <th className="px-5 py-3 font-medium hidden lg:table-cell">
                  Направление бизнеса
                </th>
                <th className="px-5 py-3 font-medium hidden lg:table-cell">
                  Контрагент
                </th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">
                  Назначение платежа
                </th>
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-8 text-center text-slate-400"
                  >
                    Нет фактических платежей по выбранным фильтрам
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                      {formatDate(p.date)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold whitespace-nowrap ${
                        p.amount >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {formatMoney(p.amount)}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {getAccountName(p.accountId)}
                    </td>
                    <td className="px-5 py-3 hidden lg:table-cell">
                      <span className="text-slate-300">—</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 hidden lg:table-cell">
                      {p.counterparty || "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden md:table-cell max-w-xs truncate">
                      {p.name}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {p.category}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Редактировать платёж" : "Новый платёж"}
      >
        <PaymentForm
          payment={editing ?? undefined}
          accounts={state.accounts}
          counterparties={counterparties}
          onSubmit={handleSubmit}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>

      <ImportDdsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingAccounts={state.accounts}
        existingPayments={state.payments}
      />
    </div>
  );
}
