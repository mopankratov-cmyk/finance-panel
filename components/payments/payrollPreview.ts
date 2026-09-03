import type { PayrollEmployee } from "./payroll";

const employee = (value: Partial<PayrollEmployee> & Pick<PayrollEmployee, "id" | "fullName" | "employmentType" | "monthlySalary">): PayrollEmployee => ({
  employmentStatus: "active",
  employmentDetails: "",
  hireDate: null,
  terminationDate: null,
  employerName: "",
  companyIds: [],
  companyId: null,
  position: "",
  project: "",
  city: "",
  workEmail: "",
  birthDate: null,
  taxRate: null,
  defaultPaymentMethod: value.employmentType === "individual_entrepreneur" || value.employmentType === "self_employed" ? "bank_account" : "card",
  bankName: "",
  phone: "",
  settlementAccountDetails: "",
  cardTransferDetails: "",
  paymentDetails: "",
  paymentDetailsMasked: "",
  notes: "Предварительный просмотр из файла Сотрудники.xlsx",
  ...value,
});

export const PAYROLL_PREVIEW_EMPLOYEES: PayrollEmployee[] = [
  employee({ id: "00000000-0000-4000-8000-000000000001", fullName: "Ефремова Алина Михайловна", employmentType: "unofficial", monthlySalary: 50_000, position: "Финансист", project: "Все проекты", city: "Краснодар", employerName: "Нет данных", bankName: "Сбер", paymentDetailsMasked: "Карта •••• 3142" }),
  employee({ id: "00000000-0000-4000-8000-000000000002", fullName: "Заляева Анастасия Сергеевна", employmentType: "unofficial", monthlySalary: 140_000, position: "Менеджер по закупкам", project: "Все проекты", city: "Казань", employerName: "Нет данных", bankName: "Т-Банк", paymentDetailsMasked: "Карта •••• 1427" }),
  employee({ id: "00000000-0000-4000-8000-000000000003", fullName: "Камалова Фаягуль Мансуровна", employmentType: "unofficial", monthlySalary: 30_000, position: "Помощник финансиста", city: "Набережные Челны", bankName: "Альфа-Банк", paymentDetailsMasked: "Карта •••• 8526", terminationDate: "2026-09-05" }),
  employee({ id: "00000000-0000-4000-8000-000000000004", fullName: "Митриченко Кристина Михайловна", employmentType: "individual_entrepreneur", monthlySalary: 100_000, position: "Финансовый директор", project: "Все проекты", city: "Краснодар", employerName: "ООО РИО", bankName: "Сбер", paymentDetailsMasked: "Расчётный счёт ИП" }),
  employee({ id: "00000000-0000-4000-8000-000000000005", fullName: "Тимошина Евгения Николаевна", employmentType: "self_employed", monthlySalary: 80_000, position: "HR", project: "Все проекты", city: "Ростов-на-Дону", employerName: "ООО РИО", bankName: "Сбер", paymentDetailsMasked: "Расчётный счёт самозанятого" }),
  employee({ id: "00000000-0000-4000-8000-000000000006", fullName: "Шук Оксана Александровна", employmentType: "individual_entrepreneur", monthlySalary: 0, position: "Бухгалтер", project: "Все проекты", city: "Москва", employerName: "Нет данных", bankName: "Т-Банк", paymentDetailsMasked: "Расчётный счёт ИП" }),
  employee({ id: "00000000-0000-4000-8000-000000000007", fullName: "Лушникова Ксения Александрована", employmentType: "self_employed", monthlySalary: 120_000, position: "Менеджер Ozon", bankName: "Сбер", paymentDetailsMasked: "Расчётный счёт самозанятого" }),
];
