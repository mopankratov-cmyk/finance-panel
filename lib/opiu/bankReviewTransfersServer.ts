import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { findCertainTransferPairs } from "./bankTransferMatching";
import { transferCategories } from "./bankTransferClassification";

export async function matchBankReviewTransfers() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Серверная база не настроена");
  const rows = await loadAllSupabasePages<{ id: string; date: string; amount: number; bank_account_number: string; owner_inn: string; counterparty_inn: string; reasons: string[]; company_id: string | null }>((from,to) => db.from("bank_review_items")
    .select("id,date,amount,bank_account_number,owner_inn,counterparty_inn,reasons,company_id")
    .in("status", ["ready","needs_info","waiting_manager","approved"]).is("matched_transfer_id",null)
    .order("date").order("id").range(from,to), { label: "Встречные операции всех выписок" });
  const byId = new Map(rows.map(row => [row.id,row]));
  const pairs = findCertainTransferPairs(rows.map(row => ({ id: row.id, date: row.date, amount: Number(row.amount), bankAccountNumber: row.bank_account_number ?? "", ownerInn: row.owner_inn ?? "", counterpartyInn: row.counterparty_inn ?? "", counterpartyAccount: (row.reasons ?? []).find(reason => reason.startsWith("__counterparty_account:"))?.slice("__counterparty_account:".length) ?? "" })));
  for (const pair of pairs) {
    const categories = transferCategories(byId.get(pair.outgoingId)?.company_id ?? null, byId.get(pair.incomingId)?.company_id ?? null);
    const result = await db.rpc("link_bank_review_transfer", { p_outgoing: pair.outgoingId, p_incoming: pair.incomingId, p_outgoing_category: categories.outgoing, p_incoming_category: categories.incoming });
    if (result.error) throw new Error(/PGRST202|42883/.test(result.error.code) ? "Для связывания выписок примените миграцию 202609140003_bank_review_confirm_and_link.sql" : result.error.message);
  }
  return pairs.length;
}
