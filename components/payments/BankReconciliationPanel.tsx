"use client";

import { AlertCircle, Bot, CheckCircle2, Clock3, Eye, FileSpreadsheet, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Hint } from "@/components/ui/Hint";
import { formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";

export function BankReconciliationPanel({
  accounts,
  onImportStatement,
}: {
  accounts: Account[];
  onImportStatement: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile icon={FileSpreadsheet} label="Выписка" value="Готова к импорту" tone="emerald" />
        <StatusTile icon={Eye} label="Страница банка" value="Ожидает подключения" tone="amber" />
        <StatusTile icon={Bot} label="ИИ-сверка" value="Подготовлена архитектура" tone="violet" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Контроль банковских счетов</h2>
            <p className="mt-1 text-sm text-slate-500">
              Сопоставление выписки, операций на странице банка, резервов и факта ДДС.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onImportStatement} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">
              <FileSpreadsheet className="h-4 w-4" /> Загрузить выписку
            </button>
            <button disabled title="Станет доступно после подключения локального помощника банка" className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-400">
              <RefreshCw className="h-4 w-4" /> Сверить открытую вкладку
            </button>
            {/* Почему кнопка серая, знал только `title`, а он не всплывает под
                пальцем: причина отключения ставилась рядом отдельным значком. */}
            <Hint label="Почему «Сверить открытую вкладку» недоступна">
              Станет доступно после подключения локального помощника банка.
            </Hint>
          </div>
        </div>
        <div className="scroll-x">
          <table className="w-full min-w-[860px] text-sm">
            {/* Фон шапки непрозрачный: как только она станет липкой, строки
                начнут просвечивать сквозь неё. */}
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Кошелёк</th>
                <th className="px-5 py-3 text-right font-medium">Баланс панели</th>
                <th className="px-5 py-3 text-right font-medium">Баланс банка</th>
                <th className="px-5 py-3 text-right font-medium">В обработке</th>
                <th className="px-5 py-3 text-right font-medium">Расхождение</th>
                <th className="px-5 py-3 font-medium">Состояние</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-900">{account.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatMoney(account.balance)}</td>
                  <td className="px-5 py-3 text-right text-slate-400">—</td>
                  <td className="px-5 py-3 text-right text-slate-400">—</td>
                  <td className="px-5 py-3 text-right text-slate-400">—</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      <Clock3 className="h-3.5 w-3.5" /> Нет снимка банка
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <div className="flex gap-3">
              <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600" />
              <div>
                <h3 className="font-semibold text-slate-900">Безопасный режим чтения</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Будущий помощник читает только открытую вами страницу операций. Он не получает пароль, не создаёт
                  платежи и не нажимает подтверждение в банке.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex gap-3">
              <AlertCircle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-semibold text-slate-900">Что считается расхождением</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Платёж только в банке, операция только в выписке, неподтверждённый резерв, несовпавшая сумма или
                  различие между текущим и расчётным остатком.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/60 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
            <Link2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-violet-950">Следующий этап подключения</h3>
            <p className="mt-1 text-sm text-violet-800">
              Владелец добавит защищённый локальный помощник для конкретного банка. После этого здесь появятся
              фактические остатки, операции «в обработке» и объяснения ИИ.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
            <CheckCircle2 className="h-4 w-4" /> Интерфейс готов
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof FileSpreadsheet;
  label: string;
  value: string;
  tone: "emerald" | "amber" | "violet";
}) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-0.5 font-semibold text-slate-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
