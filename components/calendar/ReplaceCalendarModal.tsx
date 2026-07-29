"use client";

import { FileUp, RefreshCw } from "lucide-react";
import { useState } from "react";
import { parseCalendarGridCsv } from "./calendarGridImport";
import { Modal } from "@/components/ui/Modal";
import type { DdsCompany } from "@/components/payments/ddsCompanies";
import type { Account, Payment } from "@/lib/types";

export function ReplaceCalendarModal({
  open,
  onClose,
  accounts,
  companies,
  existingCount,
  onReplace,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  companies: DdsCompany[];
  existingCount: number;
  onReplace: (payments: Payment[], companyId: string | null) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [companyId, setCompanyId] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const readFile = async (file: File) => {
    try {
      const parsed = parseCalendarGridCsv(await file.text(), accountId);
      setPayments(parsed);
      setFileName(file.name);
      setError("");
    } catch (fileError) {
      setPayments([]);
      setError(fileError instanceof Error ? fileError.message : "Не удалось прочитать календарь");
    }
  };

  const replace = async () => {
    if (!payments.length || !accountId) return;
    if (!confirm(`Удалить ${existingCount} старых плановых строк этой компании и заменить их данными из файла?`)) return;
    setSaving(true);
    try {
      await onReplace(payments.map((payment) => ({ ...payment, accountId })), companyId || null);
      setPayments([]);
      setFileName("");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось заменить календарь");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Заменить платёжный календарь">
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Этот режим удаляет только старые плановые строки выбранной компании. Фактические платежи ДДС и календари других компаний сохраняются.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Компания
            <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3">
              <option value="">Не назначать — определить построчно</option>
              {companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Кошелёк для строк без кошелька
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3">
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
        </div>
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-200 bg-violet-50 text-center hover:bg-violet-100">
          <FileUp className="mb-2 h-5 w-5 text-violet-700" />
          <span className="font-semibold text-violet-800">Выбрать CSV календаря</span>
          <input type="file" accept=".csv" className="hidden" onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} />
        </label>
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {payments.length > 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold">{fileName}</p>
          <p className="mt-1">Найдено: {payments.length} операций · оплачено {payments.filter((payment) => payment.status === "done").length} · запланировано {payments.filter((payment) => payment.status === "planned").length}</p>
          <p className="mt-1">Период: {payments.map((payment) => payment.date).sort()[0]} — {payments.map((payment) => payment.date).sort().at(-1)}</p>
        </div>}
        <button onClick={() => void replace()} disabled={!payments.length || saving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
          {saving ? "Заменяю календарь…" : `Заменить плановые строки · ${payments.length || 0}`}
        </button>
      </div>
    </Modal>
  );
}
