import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES, TRANSFER_CATEGORIES } from "@/lib/finance/categories";

export function transferCategories(outgoingCompanyId: string | null, incomingCompanyId: string | null) {
  const sameCompany = Boolean(outgoingCompanyId && incomingCompanyId && outgoingCompanyId === incomingCompanyId);
  return sameCompany
    ? { outgoing: TRANSFER_CATEGORIES.outgoing, incoming: TRANSFER_CATEGORIES.incoming }
    : { outgoing: INTERCOMPANY_LOAN_CATEGORIES.issued, incoming: LOAN_CATEGORIES.receipt };
}
