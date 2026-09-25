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
  const companyIds = [...new Set(rows.flatMap(row => row.company_id ? [row.company_id] : []))];
  const companies = companyIds.length
    ? await db.from("companies").select("id,name,group_name").in("id", companyIds)
    : { data: [], error: null };
  if (companies.error) throw new Error(companies.error.message);
  const companyById = new Map((companies.data ?? []).map(company => [String(company.id), {
    id: String(company.id),
    name: String(company.name ?? ""),
    groupName: String(company.group_name ?? ""),
  }]));
  const byId = new Map(rows.map(row => [row.id,row]));
  const pairs = findCertainTransferPairs(rows.map(row => ({ id: row.id, date: row.date, amount: Number(row.amount), bankAccountNumber: row.bank_account_number ?? "", ownerInn: row.owner_inn ?? "", counterpartyInn: row.counterparty_inn ?? "", counterpartyAccount: (row.reasons ?? []).find(reason => reason.startsWith("__counterparty_account:"))?.slice("__counterparty_account:".length) ?? "" })));
  let linkedCount = 0;
  for (const pair of pairs) {
    const outgoingCompany = companyById.get(byId.get(pair.outgoingId)?.company_id ?? "");
    const incomingCompany = companyById.get(byId.get(pair.incomingId)?.company_id ?? "");
    // Реквизиты доказывают связь строк, но без компаний нельзя решить,
    // обычный это перевод или специальный займ Филиппову.
    if (!outgoingCompany || !incomingCompany) continue;
    const categories = transferCategories(outgoingCompany, incomingCompany);
    const result = await db.rpc("link_bank_review_transfer", { p_outgoing: pair.outgoingId, p_incoming: pair.incomingId, p_outgoing_category: categories.outgoing, p_incoming_category: categories.incoming });
    if (result.error) throw new Error(/PGRST202|42883/.test(result.error.code) ? "Для связывания выписок примените миграцию 202609140003_bank_review_confirm_and_link.sql" : result.error.message);
    linkedCount += 1;
  }
  return linkedCount;
}
