import type { BankStatement } from "./bankStatement";

export function importedBankAccountName(input: string, accountNumber: string) {
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) return "";
  const lastFour = accountNumber.replace(/\D/g, "").slice(-4);
  if (!lastFour || name.replace(/\D/g, "").endsWith(lastFour)) return name;
  return `${name} · ••••${lastFour}`;
}

export function importedBankAccountOpeningDate(statement: Pick<BankStatement, "dateFrom" | "rows">) {
  return statement.dateFrom || statement.rows.map((row) => row.date).filter(Boolean).sort()[0]
    || new Date().toISOString().slice(0, 10);
}
