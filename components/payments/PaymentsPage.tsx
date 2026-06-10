"use client";

import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { PaymentForm } from "./PaymentForm";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PAYMENT_CATEGORIES, PAYMENT_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatMoney, generateId } from "@/lib/format";
import type { Payment, PaymentStatus } from "@/lib/types";

export function PaymentsPage() {
  const { state, dispatch } = useFinance();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAccount, setFilterAccount] = useState("");

  const filtered = useMemo(() => {
    return state.payments
      .filter((p) => {
        if (dateFrom && p.date < dateFrom) return false;
        if (dateTo && p.date > dateTo) return false;
        if (filterCategory && p.category !== filterCategory) return false;
        if (filterStatus && p.status !== filterStatus) return false;
        if (filterAccount && p.accountId !== filterAccount) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [
    state.payments,
    dateFrom,
    dateTo,
    filterCategory,
    filterStatus,
    filterAccount,
  ]);

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

  const handleMarkDone = (id: string) => {
    dispatch({ type: "MARK_PAYMENT_DONE", payload: id });
  };

  const statusBadge = (status: PaymentStatus) => {
    const colors = {
      planned: "bg-amber-100 text-amber-700",
      done: "bg-emerald-100 text-emerald-700",
      cancelled: "bg-slate-100 text-slate-500",
    };
    return (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}
      >
        {PAYMENT_STATUS_LABELS[status]}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Платежи</h1>
          <p className="text-sm text-slate-400 mt-1">
            Реестр платежей и поступлений
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Новый платёж
        </button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                Категория
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
              <label className="block text-xs text-slate-500 mb-1">Статус</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                <option value="planned">Запланирован</option>
                <option value="done">Выполнен</option>
                <option value="cancelled">Отменён</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Счёт</label>
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
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium text-right">Сумма</th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">
                  Категория
                </th>
                <th className="px-5 py-3 font-medium hidden lg:table-cell">
                  Счёт
                </th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium hidden sm:table-cell">
                  Контрагент
                </th>
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
                    Нет платежей по выбранным фильтрам
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                      {formatDate(p.date)}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {p.name}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold whitespace-nowrap ${
                        p.amount >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {formatMoney(p.amount)}
                    </td>
                    <td className="px-5 py-3 text-slate-600 hidden md:table-cell">
                      {p.category}
                    </td>
                    <td className="px-5 py-3 text-slate-600 hidden lg:table-cell">
                      {getAccountName(p.accountId)}
                    </td>
                    <td className="px-5 py-3">{statusBadge(p.status)}</td>
                    <td className="px-5 py-3 text-slate-600 hidden sm:table-cell">
                      {p.counterparty || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {p.status === "planned" && (
                          <button
                            onClick={() => handleMarkDone(p.id)}
                            title="Отметить выполненным"
                            className="rounded-lg p-1.5 text-violet-600 hover:bg-violet-50"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
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
          onSubmit={handleSubmit}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>
    </div>
  );
}
