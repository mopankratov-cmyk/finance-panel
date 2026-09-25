import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES, TRANSFER_CATEGORIES } from "@/lib/finance/categories";
import { requiresKorovkinLoan, type ChainCompany } from "@/lib/finance/paymentChains";

export type TransferCompany = Pick<ChainCompany, "id" | "name" | "groupName">;

export function transferCategories(outgoing: TransferCompany, incoming: TransferCompany) {
  // По правилу владельца разные юрлица основной группы остаются обычным
  // переводом. Займ возникает только из основной группы в контур
  // Филиппова/Коровкина (алиасы собраны в companyAliases).
  return requiresKorovkinLoan(outgoing, incoming)
    ? { outgoing: INTERCOMPANY_LOAN_CATEGORIES.issued, incoming: LOAN_CATEGORIES.receipt }
    : { outgoing: TRANSFER_CATEGORIES.outgoing, incoming: TRANSFER_CATEGORIES.incoming };
}
