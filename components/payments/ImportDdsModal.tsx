"use client";

import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { createDdsCompany, type DdsCompany } from "./ddsCompanies";
import { parseDdsCsv, type DdsParseResult } from "./ddsCsv";
import {
  buildImportPlan,
  commitImport,
  planImport,
  type CompanyAssignment,
  type ImportPlan,
} from "./ddsImport";
import { buildDdsSummary } from "./ddsSummary";
import { Modal } from "@/components/ui/Modal";
import type { Account, Payment } from "@/lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${n < 0 ? "−" : "+"}${fmt(Math.abs(n))} ₽`;

interface Props {
  open: boolean;
  onClose: () => void;
  existingAccounts: Account[];
  existingPayments: Array<Payment & { companyId?: string | null }>;
  companies: DdsCompany[];
  onCompanyCreated: (company: DdsCompany) => void;
}

export function ImportDdsModal({
  open,
  onClose,
  existingAccounts,
  existingPayments,
  companies,
  onCompanyCreated,
}: Props) {
  const [result, setResult] = useState<DdsParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null); // свежий план для проверки
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [done, setDone] = useState<{
    accountsCreated: number;
    paymentsCreated: number;
    companiesAssigned: number;
    duplicatesSkipped: number;
    suspectedSkipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyMode, setCompanyMode] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyGroup, setNewCompanyGroup] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);

  // Единственное место сброса состояния окна. Оно стабильно (сеттеры useState
  // не меняются), поэтому close остаётся стабильным вместе с ним.
  const reset = useCallback(() => {
    setResult(null);
    setFileName("");
    setPlan(null);
    setAccepted(new Set());
    setReviewing(false);
    setDone(null);
    setError(null);
    setCompanyMode("");
    setAddingCompany(false);
    setNewCompanyName("");
    setNewCompanyGroup("");
  }, []);

  const handleFile = async (file: File) => {
    setParsing(true);
    setError(null);
    setDone(null);
    setReviewing(false);
    setPlan(null);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("CSV-файл больше 20 МБ");
      const text = await file.text();
      const parsed = parseDdsCsv(text);
      setResult(parsed);
      const hasNamedCompanies = parsed.drafts.some((draft) => draft.company !== "Группа (общее)");
      setCompanyMode(hasNamedCompanies ? "from-file" : "");
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
      setResult(null);
    } finally {
      setParsing(false);
    }
  };

  const summary = useMemo(() => (result ? buildDdsSummary(result.drafts) : null), [result]);
  const assignment = useMemo<CompanyAssignment>(() => {
    if (companyMode === "from-file") return { companies };
    if (companyMode === "unassigned") return { companies, overrideCompanyId: null };
    return { companies, overrideCompanyId: companyMode || null };
  }, [companies, companyMode]);
  // оценка для превью — по данным в памяти
  const preview = useMemo(
    () =>
      result
        ? buildImportPlan(
            result,
            { accounts: existingAccounts, payments: existingPayments },
            assignment,
          )
        : null,
    [result, existingAccounts, existingPayments, assignment],
  );

  const handleLoad = async () => {
    if (!result) return;
    setImporting(true);
    setError(null);
    try {
      if (!companyMode) throw new Error("Выберите, к какому юрлицу относится файл");
      const fresh = await planImport(result, assignment); // сверка со свежей базой
      if (fresh.suspectedRows.length > 0) {
        setPlan(fresh);
        setAccepted(new Set());
        setReviewing(true);
      } else {
        setDone(await commitImport(fresh, new Set()));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setImporting(false);
    }
  };

  const handleCreateCompany = async () => {
    setSavingCompany(true);
    setError(null);
    try {
      const company = await createDdsCompany(newCompanyName, newCompanyGroup);
      onCompanyCreated(company);
      setCompanyMode(company.id);
      setAddingCompany(false);
      setNewCompanyName("");
      setNewCompanyGroup("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить юрлицо");
    } finally {
      setSavingCompany(false);
    }
  };

  const handleCommit = async () => {
    if (!plan) return;
    setImporting(true);
    setError(null);
    try {
      setDone(await commitImport(plan, accepted));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setImporting(false);
    }
  };

  const toggle = (id: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Функция закрытия обязана быть стабильной: общее окно держит на ней Escape
  // и ловушку фокуса, и пересоздание на каждый ввод возвращало бы фокус в
  // начало окна прямо во время работы со списком дублей.
  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const nothingNew = preview
    ? preview.newPaymentRows.length === 0 &&
      preview.suspectedRows.length === 0 &&
      preview.accountRows.length === 0 &&
      preview.companyUpdates.length === 0
    : false;

  return (
    <Modal open={open} onClose={close} title="Импорт ДДС из CSV">
      {done ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800">
            Готово! Создано счетов: <b>{done.accountsCreated}</b>, платежей: <b>{done.paymentsCreated}</b>.
            {done.companiesAssigned > 0 && <> Компания назначена существующим платежам: <b>{done.companiesAssigned}</b>.</>}
            {done.duplicatesSkipped > 0 && <> Точных дублей пропущено: <b>{done.duplicatesSkipped}</b>.</>}
            {done.suspectedSkipped > 0 && <> Под вопросом пропущено: <b>{done.suspectedSkipped}</b>.</>}
          </div>
          <p className="text-slate-500">Обновите страницу, чтобы данные подгрузились в реестр и свод.</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-700"
          >
            Обновить страницу
          </button>
        </div>
      ) : reviewing && plan ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
            Эти платежи совпали по <b>дате, сумме и кошельку</b> с уже имеющимися. Отметьте те, что нужно
            всё-таки добавить. Неотмеченные — пропустятся.
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Под вопросом: {plan.suspectedRows.length} · отмечено: {accepted.size}</span>
            <div className="flex gap-2">
              {/* Единственный способ разом принять или снять дубли: строчка в
                  16px пальцем не нажимается, поэтому область нажатия расширена
                  без изменения внешнего размера. */}
              <button onClick={() => setAccepted(new Set(plan.suspectedRows.map((s) => s.row.id)))} className="tap-hit text-violet-600 hover:underline">
                Отметить все
              </button>
              <button onClick={() => setAccepted(new Set())} className="tap-hit text-slate-500 hover:underline">
                Снять все
              </button>
            </div>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {plan.suspectedRows.map((s) => (
              <label
                key={s.row.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={accepted.has(s.row.id)}
                  onChange={() => toggle(s.row.id)}
                  className="mt-1 h-4 w-4 accent-violet-600"
                />
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">
                    {s.row.date} · <span className={s.row.amount < 0 ? "text-red-600" : "text-emerald-600"}>{money(s.row.amount)}</span> · {s.wallet}
                  </div>
                  <div className="truncate text-slate-600">{s.row.category} — {s.row.name}</div>
                  <div className="truncate text-[11px] text-slate-400">
                    похоже на имеющийся: {s.match.category} — {s.match.name}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{error}</div>}

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Точно новых платежей также добавится: {fmt(plan.newPaymentRows.length)}</span>
          </div>
          <button
            onClick={handleCommit}
            disabled={importing}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            {importing ? "Загружаю…" : `Загрузить (${fmt(plan.newPaymentRows.length + accepted.size)} платежей)`}
          </button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-slate-500 hover:border-violet-400 hover:text-violet-600">
            <FileUp className="h-5 w-5" />
            {fileName || "Выбрать CSV-файл ДДС"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={parsing || importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>

          {parsing && (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Читаю файл…
            </div>
          )}

          {result && summary && preview && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <label htmlFor="dds-company" className="mb-1 block text-xs font-medium text-slate-600">
                  К какому юрлицу относится файл
                </label>
                <select
                  id="dds-company"
                  value={companyMode}
                  onChange={(e) => setCompanyMode(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Выберите юрлицо</option>
                  <option value="from-file">Брать из колонки «Направление бизнеса»</option>
                  <option value="unassigned">Общее по группе (без одного юрлица)</option>
                  {companies.filter((company) => company.isActive).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name} · {company.groupName}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  Для отдельного ДДС, например Коровкина, выберите одно юрлицо для всего файла.
                </p>
                <button
                  type="button"
                  onClick={() => setAddingCompany((value) => !value)}
                  className="mt-2 min-h-11 text-sm font-medium text-violet-700 hover:underline"
                >
                  {addingCompany ? "Отменить добавление" : "+ Добавить новое юрлицо"}
                </button>
                {addingCompany && (
                  <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="new-company-name" className="mb-1 block text-xs text-slate-500">Название</label>
                      <input
                        id="new-company-name"
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder="Например, ООО Новое"
                        className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="new-company-group" className="mb-1 block text-xs text-slate-500">Группа</label>
                      <input
                        id="new-company-group"
                        value={newCompanyGroup}
                        onChange={(e) => setNewCompanyGroup(e.target.value)}
                        placeholder="Основная группа"
                        className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateCompany}
                      disabled={savingCompany || !newCompanyName.trim() || !newCompanyGroup.trim()}
                      className="min-h-11 rounded-lg bg-slate-800 px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
                    >
                      {savingCompany ? "Добавляю…" : "Добавить юрлицо"}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Stat label="Платежей в файле" value={fmt(result.drafts.length)} />
                <Stat label="Чистый поток" value={`${fmt(summary.realNet)} ₽`} good={summary.realNet >= 0} bad={summary.realNet < 0} />
                <Stat
                  label="Точно новых"
                  value={fmt(preview.newPaymentRows.length)}
                  sub={
                    preview.companyUpdates.length > 0
                      ? `компания заполнится: ${fmt(preview.companyUpdates.length)}`
                      : preview.duplicatePayments > 0
                        ? `точных дублей: ${fmt(preview.duplicatePayments)}`
                        : undefined
                  }
                />
                <Stat
                  label="Под вопросом"
                  value={fmt(preview.suspectedRows.length)}
                  sub={preview.suspectedRows.length > 0 ? "спросим перед добавлением" : undefined}
                />
                {result.skipped > 0 && (
                  <Stat label="Пропущено строк" value={fmt(result.skipped)} sub="нет даты или суммы — проверьте файл" bad />
                )}
              </div>

              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}

              {nothingNew ? (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-600">
                  Всё из этого файла уже загружено — новых записей нет.
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-600">
                  Точные дубли пропустятся; совпавшие по дате+сумме+кошельку — спросим отдельно.
                </div>
              )}

              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{error}</div>}

              <button
                onClick={handleLoad}
                disabled={importing || nothingNew || !companyMode}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                {importing ? "Проверяю базу…" : "Загрузить в базу"}
              </button>
            </div>
          )}

          {error && !result && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-semibold ${good ? "text-emerald-700" : bad ? "text-red-600" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
