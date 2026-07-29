"use client";

import { BarChart3, Download, FileSpreadsheet, Landmark, LayoutDashboard, ListChecks, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, WalletCards } from "lucide-react";
import { BankStatementModal } from "./BankStatementModal";
import { BankReviewPanel } from "./BankReviewPanel";
import { BankReconciliationPanel } from "./BankReconciliationPanel";
import { DdsOverview } from "./DdsOverview";
import { useEffect, useMemo, useState } from "react";
import { DdsReport } from "./DdsReport";
import {
  loadDdsCompanies,
  loadPaymentCompanyLinks,
  savePaymentWithCompany,
  type DdsCompany,
} from "./ddsCompanies";
import { cleanDemoData } from "./ddsImport";
import { ddsTemplateRows, downloadDdsCsv, downloadDdsXlsx } from "./ddsExport";
import { syncDdsToGoogleSheets } from "./ddsGoogleSync";
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
  const [mode, setMode] = useState<"overview" | "ledger" | "dds" | "review" | "reconciliation">("overview");
  const [importOpen, setImportOpen] = useState(false);
  const [bankImportOpen, setBankImportOpen] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [companies, setCompanies] = useState<DdsCompany[]>([]);
  const [companyByPayment, setCompanyByPayment] = useState<Map<string, string | null>>(new Map());
  const [companyError, setCompanyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDdsCompanies(), loadPaymentCompanyLinks()])
      .then(([loadedCompanies, links]) => {
        if (cancelled) return;
        setCompanies(loadedCompanies);
        setCompanyByPayment(new Map(links.map((link) => [link.paymentId, link.companyId])));
        setCompanyError(null);
      })
      .catch((error) => {
        if (!cancelled) setCompanyError(error instanceof Error ? error.message : "Не удалось загрузить компании");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const companyNameById = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name] as const)),
    [companies],
  );
  const accountNameById = useMemo(
    () => new Map(state.accounts.map((account) => [account.id, account.name] as const)),
    [state.accounts],
  );

  const paymentsWithCompany = useMemo(
    () =>
      state.payments.map((payment) => ({
        ...payment,
        companyId: companyByPayment.get(payment.id) ?? null,
      })),
    [state.payments, companyByPayment],
  );

  const filtered = useMemo(() => {
    return paymentsWithCompany
      .filter((p) => {
        if (p.status !== "done") return false; // реестр — только факт; план — в платёжном календаре
        if (dateFrom && p.date < dateFrom) return false;
        if (dateTo && p.date > dateTo) return false;
        if (filterCategory && p.category !== filterCategory) return false;
        if (filterAccount && p.accountId !== filterAccount) return false;
        if (filterCompany === "unassigned" && p.companyId !== null) return false;
        if (filterCompany && filterCompany !== "unassigned" && p.companyId !== filterCompany) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [paymentsWithCompany, dateFrom, dateTo, filterCategory, filterAccount, filterCompany]);

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

  const handleSubmit = async (data: Omit<Payment, "id">, companyId: string) => {
    const payment = { id: editing?.id ?? generateId("pay"), ...data };
    try {
      await savePaymentWithCompany(payment, companyId);
      setModalOpen(false);
      setEditing(null);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить платёж");
    }
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

  const handleGoogleSync = async () => {
    setSyncingGoogle(true);
    try {
      const result = await syncDdsToGoogleSheets(ddsTemplateRows({ payments: paymentsWithCompany, accountNameById, companyNameById }));
      alert(`Google Таблица обновлена. Строк: ${result.rows}. Листы: ${result.sheets.join(", ")}.`);
      if (result.spreadsheetUrl && confirm("Открыть Google Таблицу?")) window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось обновить Google Таблицу");
    } finally {
      setSyncingGoogle(false);
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
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-950">Движение денег</h1>
              <p className="text-sm text-slate-500">Факт, проверка, компании и банковская сверка</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload className="h-4 w-4" />
            Импорт ДДС
          </button>
          <button
            onClick={() => setBankImportOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Выписка банка
          </button>
        </div>
        </div>
        <div className="overflow-x-auto border-t border-slate-100 px-2">
          <div className="flex min-w-max gap-1">
            {([
              ["overview", "Обзор", LayoutDashboard],
              ["ledger", "Платежи", ListChecks],
              ["dds", "Отчёт ДДС", BarChart3],
              ["review", "На проверке", FileSpreadsheet],
              ["reconciliation", "Сверка банка", Landmark],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`inline-flex min-h-12 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
                  mode === value
                    ? "border-violet-600 text-violet-700"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => downloadDdsCsv({ payments: paymentsWithCompany, accountNameById, companyNameById })}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            onClick={() => downloadDdsXlsx({ payments: paymentsWithCompany, accountNameById, companyNameById })}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
          <button
            onClick={handleGoogleSync}
            disabled={syncingGoogle}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Google Таблица
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

      {companyError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {companyError}
        </div>
      )}

      {mode === "overview" && (
        <DdsOverview
          payments={paymentsWithCompany}
          accounts={state.accounts}
          companies={companies}
          onOpenLedger={() => setMode("ledger")}
          onOpenReview={() => setMode("review")}
          onOpenReconciliation={() => setMode("reconciliation")}
        />
      )}
      {mode === "dds" && <DdsReport payments={paymentsWithCompany} companies={companies} />}
      {mode === "review" && <BankReviewPanel accounts={state.accounts} companies={companies} />}
      {mode === "reconciliation" && (
        <BankReconciliationPanel accounts={state.accounts} onImportStatement={() => setBankImportOpen(true)} />
      )}

      {mode === "ledger" && (
        <>
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
            <div>
              <label className="block text-xs text-slate-500 mb-1">Компания</label>
              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Все компании</option>
                <option value="unassigned">Общее по группе</option>
                {companies.filter((company) => company.isActive).map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
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
                      <span className={p.companyId ? "text-slate-700" : "text-slate-400"}>
                        {p.companyId ? companyNameById.get(p.companyId) ?? "Неизвестная компания" : "Общее по группе"}
                      </span>
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
          companies={companies}
          companyId={editing ? companyByPayment.get(editing.id) : null}
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
        existingPayments={paymentsWithCompany}
        companies={companies}
        onCompanyCreated={(company) => setCompanies((current) => [...current, company])}
      />
      <BankStatementModal
        open={bankImportOpen}
        onClose={() => setBankImportOpen(false)}
        accounts={state.accounts}
        companies={companies}
        existingPayments={paymentsWithCompany}
        onQueued={() => setMode("review")}
      />
    </div>
  );
}
