"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AccountForm } from "./AccountForm";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { getTotalBalance, getTotalBalanceByCurrency } from "@/lib/calculations";
import { accountBalance } from "@/lib/finance/balance";
import { ACCOUNT_TYPE_LABELS } from "@/lib/constants";
import { formatDate, formatMoney, generateId, todayISO } from "@/lib/format";
import type { Account } from "@/lib/types";

export function AccountsPage() {
  const { state, dispatch } = useFinance();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  const today = todayISO();
  const totalBalance = getTotalBalance(state.accounts, state.payments, today);
  const byCurrency = getTotalBalanceByCurrency(state.accounts, state.payments, today);

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setModalOpen(true);
  };

  const handleSubmit = (data: Omit<Account, "id">) => {
    if (editing) {
      dispatch({ type: "UPDATE_ACCOUNT", payload: { ...editing, ...data } });
    } else {
      dispatch({
        type: "ADD_ACCOUNT",
        payload: { id: generateId("acc"), ...data },
      });
    }
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить этот счёт?")) {
      dispatch({ type: "DELETE_ACCOUNT", payload: id });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Счета</h1>
          <p className="text-sm text-slate-400 mt-1">
            Управление счетами и балансами
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Добавить счёт
        </button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-slate-500">Общий остаток в рублях на сегодня</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {formatMoney(totalBalance)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(byCurrency).map(([cur, amt]) => (
              <span
                key={cur}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {formatMoney(amt, cur as "RUB" | "USD")}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.accounts.map((account) => (
          <Card key={account.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{account.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(account)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xl font-bold text-slate-900">
                {formatMoney(accountBalance(account, state.payments, today), account.currency)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {account.openingDate
                  ? `Открытие ${formatDate(account.openingDate)}: ${formatMoney(account.openingBalance ?? 0, account.currency)} · дальше по платежам`
                  : "Дата остатка не задана — показано ручное число"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Редактировать счёт" : "Новый счёт"}
      >
        <AccountForm
          account={editing ?? undefined}
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
