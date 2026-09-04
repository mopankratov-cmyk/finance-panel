// Разбор штатного Excel («Сотрудники.xlsx») в сотрудников — на сервере.
// Раньше парсер жил внутри React-компонента, а вместе с ним — зашитые фамилии
// семи действующих сотрудников и дата увольнения одного человека. Теперь статус
// берётся из самого файла: есть дата увольнения — уволен, нет — действующий.
// Реквизиты и контакты из строки уходят только в закрытую таблицу (private-роут);
// публичный роут отдаёт сотрудников без них (publicStaffFields).

import type { PayrollEmployee, PayrollEmploymentType } from "@/components/payments/payroll";

interface CompanyLike { id: string; name: string }

export function spreadsheetMoney(value: string): number {
  const match = String(value ?? "").replace(/ /g, " ").match(/\d[\d .]*(?:,\d+)?/);
  if (!match) return 0;
  const raw = match[0].trim();
  if (/^\d{1,3}\.\d{3}$/.test(raw)) return Number(raw.replace(".", ""));
  return Number(raw.replace(/\s/g, "").replace(",", ".")) || 0;
}

export function spreadsheetDate(value: string): string | null {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1);
  if (iso) return `${iso[0]}-${iso[1]}-${iso[2]}`;
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  // Excel хранит даты числом дней с 30.12.1899 — сервер читает ячейку как число.
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20_000 && serial < 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

function splitPaymentDetails(details: string) {
  const isSettlementAccount = /р\/?с|расчетн|расчётн|бик|корр(?:еспондентский)?\s*сч/i.test(details);
  return {
    settlementAccountDetails: isSettlementAccount ? details : "",
    cardTransferDetails: isSettlementAccount ? "" : details,
  };
}

function companyIdsFromRow(row: string[], companies: CompanyLike[]): string[] {
  const source = [row[2], row[5], row[9], row[10], row[11]].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
  return companies.filter((company) => {
    const name = company.name.toLocaleLowerCase("ru-RU").replace(/[^a-zа-я0-9 ]/gi, " ");
    const terms = name.split(/\s+/).filter((term) => term.length >= 3 && !["ооо", "ип"].includes(term));
    return terms.length > 0 && terms.every((term) => source.includes(term));
  }).map((company) => company.id);
}

/** Сотрудники из сетки первого листа: две строки шапки, колонки как в файле «Сотрудники.xlsx». */
export function staffFromGrid(grid: string[][], companies: CompanyLike[] = []): PayrollEmployee[] {
  return grid.slice(2).flatMap((row, index) => {
    const fullName = String(row[1] ?? "").replace(/\s+/g, " ").trim();
    if (!fullName) return [];
    const employment = String(row[2] ?? "").toLowerCase();
    const employmentType: PayrollEmploymentType = /частич/.test(employment) ? "partial" : /самозан/.test(employment) ? "self_employed" : /инд|^ип\b/.test(employment) ? "individual_entrepreneur" : /неофиц/.test(employment) ? "unofficial" : "official";
    const details = String(row[17] ?? "").trim();
    const digits = details.replace(/\D/g, "");
    const terminationDate = spreadsheetDate(row[6] ?? "");
    const companyIds = companyIdsFromRow(row, companies);
    return [{
      id: `00000000-0000-4001-8000-${String(index + 1).padStart(12, "0")}`,
      fullName,
      employmentStatus: terminationDate ? "terminated" : "active",
      employmentType,
      employmentDetails: employment,
      hireDate: spreadsheetDate(row[3] ?? ""),
      terminationDate,
      employerName: String(row[5] ?? "").trim(), companyIds, companyId: companyIds[0] ?? null,
      position: String(row[8] ?? "").trim(), project: String(row[9] ?? "").trim(), city: String(row[12] ?? "").trim(),
      workEmail: String(row[13] ?? "").trim(), birthDate: spreadsheetDate(row[23] ?? ""),
      monthlySalary: spreadsheetMoney(row[14] ?? ""), taxRate: null,
      defaultPaymentMethod: employmentType === "individual_entrepreneur" || employmentType === "self_employed" ? "bank_account" : "card",
      bankName: String(row[18] ?? "").trim(), phone: String(row[24] ?? "").replace(/\.0$/, "").trim(), paymentDetails: details,
      ...splitPaymentDetails(details),
      paymentDetailsMasked: digits.length >= 4 ? `•••• ${digits.slice(-4)}` : details, notes: [row[15], row[16]].filter(Boolean).join("; "),
    }];
  });
}

/** Сотрудник без закрытых полей — для публичного роута и предпросмотра. */
export function publicStaffFields(employee: PayrollEmployee): PayrollEmployee {
  return { ...employee, bankName: "", phone: "", workEmail: "", birthDate: null, settlementAccountDetails: "", cardTransferDetails: "", paymentDetails: "", paymentDetailsMasked: employee.paymentDetailsMasked };
}
