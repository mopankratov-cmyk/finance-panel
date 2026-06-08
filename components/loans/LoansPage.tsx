"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { LoanForm } from "./LoanForm";
import { useFinance } from "@/components/providers/FinanceProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { calculateLoanTotalOwed } from "@/lib/calculations";
import { LOAN_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatMoney, generateId } from "@/lib/format";
import type { Loan } from "@/lib/types";

export function LoansPage() {
  const { state, dispatch } = useFinance();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);

  const activeLoans = state.loans.filter((l) => l.status === "active");
  const totalOwed = activeLoans.reduce(
    (sum, loan) => sum + calculateLoanTotalOwed(loan),
    0,
  );

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (loan: Loan) => {
    setEditing(loan);
    setModalOpen(true);
  };

  const handleSubmit = (data: Omit<Loan, "id">) => {
    if (editing) {
      dispatch({ type: "UPDATE_LOAN", payload: { ...editing, ...data } });
    } else {
      dispatch({
        type: "ADD_LOAN",
        payload: { id: generateId("loan"), ...data },
      });
    }
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить этот кредит?")) {
      dispatch({ type: "DELETE_LOAN", payload: id });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Кредиты и займы</h1>
          <p className="text-sm text-slate-400 mt-1">
            Учёт задолженностей и процентов
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Новый кредит
        </button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-slate-500">Общая задолженность</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {formatMoney(totalOwed)}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {activeLoans.length} активных кредитов
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {state.loans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-slate-400">
              Нет кредитов. Добавьте первый кредит или займ.
            </CardContent>
          </Card>
        ) : (
          state.loans.map((loan) => {
            const totalOwedLoan = calculateLoanTotalOwed(loan);
            const accruedInterest = totalOwedLoan - loan.principalAmount;

            return (
              <Card key={loan.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {loan.creditorName}
                      </h3>
                      <span
                        className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          loan.status === "active"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {LOAN_STATUS_LABELS[loan.status]}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(loan)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(loan.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-400">Основной долг</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatMoney(loan.principalAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Начисленные %</p>
                      <p className="text-sm font-semibold text-red-600">
                        {formatMoney(accruedInterest)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Итого к возврату</p>
                      <p className="text-sm font-bold text-slate-900">
                        {formatMoney(totalOwedLoan)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Ставка</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {loan.interestRatePerDay}% / день
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                    <span>Начало: {formatDate(loan.startDate)}</span>
                    <span>Погашение: {formatDate(loan.dueDate)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Редактировать кредит" : "Новый кредит"}
      >
        <LoanForm
          loan={editing ?? undefined}
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
