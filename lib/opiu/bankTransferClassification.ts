export function transferCategories(outgoingCompanyId: string | null, incomingCompanyId: string | null) {
  const sameCompany = Boolean(outgoingCompanyId && incomingCompanyId && outgoingCompanyId === incomingCompanyId);
  return sameCompany
    ? { outgoing: "Выбытие — Перевод между счетами", incoming: "Поступление — Перевод между счетами" }
    : { outgoing: "Выдача кредитов и займов", incoming: "Получение кредитов и займов" };
}
