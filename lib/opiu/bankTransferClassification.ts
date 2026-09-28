import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES, TRANSFER_CATEGORIES } from "@/lib/finance/categories";
import { requiresFilippovLoan, type ChainCompany } from "@/lib/finance/paymentChains";

export type TransferCompany = Pick<ChainCompany, "id" | "name" | "groupName">;

export function transferCategories(outgoing: TransferCompany, incoming: TransferCompany) {
  // По правилу владельца разные юрлица основной группы остаются обычным
  // переводом. Займ возникает только из основной группы в контур
  // Филиппова (исторический алиас собран в companyAliases).
  return requiresFilippovLoan(outgoing, incoming)
    ? { outgoing: INTERCOMPANY_LOAN_CATEGORIES.issued, incoming: LOAN_CATEGORIES.receipt }
    : { outgoing: TRANSFER_CATEGORIES.outgoing, incoming: TRANSFER_CATEGORIES.incoming };
}
