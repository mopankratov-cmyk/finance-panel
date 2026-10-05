export type EmployeeSuggestionCandidate = { id: string; fullName: string };
export type EmployeeSuggestionPayment = { counterparty?: string | null; name?: string | null; comment?: string | null };

const words = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean);

function matchesEmployeeName(value: string, employee: EmployeeSuggestionCandidate): boolean {
  const sourceWords = new Set(words(value));
  const nameWords = words(employee.fullName);
  const exactParts = nameWords.filter((part) => sourceWords.has(part)).length;
  const initialParts = nameWords.filter((part) => sourceWords.has(part[0])).length;
  return exactParts === nameWords.length || (exactParts >= 2 && initialParts >= 1);
}

function uniqueMatch(value: string | null | undefined, employees: EmployeeSuggestionCandidate[]): string | null {
  if (!value?.trim()) return null;
  const matches = employees.filter((employee) => matchesEmployeeName(value, employee));
  return matches.length === 1 ? matches[0].id : null;
}

/** Подбирает сотрудника по полному или сокращённому ФИО из банковской выписки. */
export function payrollEmployeeSuggestion(payment: EmployeeSuggestionPayment, employees: EmployeeSuggestionCandidate[]): string | null {
  return uniqueMatch(payment.counterparty, employees)
    ?? uniqueMatch(payment.name, employees)
    ?? uniqueMatch(payment.comment, employees);
}
