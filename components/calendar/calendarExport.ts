import { buildMultiSheetXlsx } from "@/components/payments/ddsExport";
import { cleanPaymentComment } from "./paymentPriority";
import type { Payment } from "@/lib/types";

export type CalendarExportSheet = { name: string; rows: Array<Array<string | number>> };

export function calendarTemplateSheets({ payments, companyNames, companyByPayment }: {
  payments: Payment[];
  accountNames: Map<string, string>;
  companyNames: Map<string, string>;
  companyByPayment: Map<string, string | null>;
}): CalendarExportSheet[] {
  const active = payments.filter((payment) => payment.status !== "cancelled").sort((a, b) => a.date.localeCompare(b.date));
  const company = (payment: Payment) => companyNames.get(companyByPayment.get(payment.id) ?? "") ?? "Не назначена";
  const income = active.filter((payment) => payment.status === "planned" && payment.amount > 0 && !payment.category.toLowerCase().includes("перевод"));
  const outflow = active.filter((payment) => payment.status === "planned" && payment.amount < 0);
  const facts = active.filter((payment) => payment.status === "done");
  return [{
    name: "Плановый Реестр поступлений",
    rows: [["Контрагент", "Статья поступлений", "Ответственный", "Сумма план", "Дата планируемого получения", "Комментарий", "Год план", "Месяц план", "Номер недели план"],
      ...income.map((p) => [p.counterparty || company(p), p.category, "", Math.abs(p.amount), p.date, cleanPaymentComment(p.comment), Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)), ""])],
  }, {
    name: "План выбытий",
    rows: [["Номер недели", "Начало недели", "Конец недели", "Стутус оплаты", "Комментарий", "Сумма план", "Дата планируемой оплаты", "Статья", "Контрагент", "Ответственный", "Год план", "Месяц план", "Повторяющийся платеж"],
      ...outflow.map((p) => ["", "", "", "Не оплачено", p.name || cleanPaymentComment(p.comment), Math.abs(p.amount), p.date, p.category, p.counterparty || company(p), "", Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)), p.comment?.includes("[recurring:") ? "Да" : "Нет"])],
  }, {
    name: "Факт ДДС",
    rows: [["Год", "Месяц", "День недели", "Дата", "Сумма", "Контрагент", "Назначение платежа", "Статья", "Платеж/поступл"],
      ...facts.map((p) => [Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)), "", p.date, p.amount, p.counterparty, p.name || cleanPaymentComment(p.comment), p.category, p.amount >= 0 ? "Поступление" : "Выбытие"])],
  }];
}

export function calendarExportRows(context: Parameters<typeof calendarTemplateSheets>[0]) {
  return calendarTemplateSheets(context)[1].rows;
}

export function downloadCalendarXlsx(sheets: CalendarExportSheet[]) {
  const bytes = buildMultiSheetXlsx(sheets);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `Платёжный_календарь_${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
