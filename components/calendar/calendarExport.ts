import { downloadSimpleXlsx } from "@/components/payments/ddsExport";
import { cleanPaymentComment, getPaymentPriority } from "./paymentPriority";
import type { Payment } from "@/lib/types";

export function calendarExportRows({
  payments,
  accountNames,
  companyNames,
  companyByPayment,
}: {
  payments: Payment[];
  accountNames: Map<string, string>;
  companyNames: Map<string, string>;
  companyByPayment: Map<string, string | null>;
}): Array<Array<string | number>> {
  return [[
    "Приоритет", "Дата", "Сумма", "Тип", "Название", "Назначение платежа",
    "Компания", "Кошелёк", "Контрагент", "Статус", "Комментарий",
  ], ...payments
    .filter((payment) => payment.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((payment) => {
      const companyId = companyByPayment.get(payment.id);
      return [
        getPaymentPriority(payment),
        payment.date,
        payment.amount,
        payment.amount >= 0 ? "Поступление" : "Расход",
        payment.category,
        payment.name,
        companyId ? companyNames.get(companyId) ?? "Неизвестная" : "Не назначена",
        accountNames.get(payment.accountId) ?? "",
        payment.counterparty,
        payment.status === "done" ? "Факт" : "План",
        cleanPaymentComment(payment.comment),
      ];
    })];
}

export function downloadCalendarXlsx(rows: Array<Array<string | number>>) {
  downloadSimpleXlsx(rows, `Платёжный_календарь_${new Date().toISOString().slice(0, 10)}.xlsx`, "Платёжный календарь");
}
