import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type FinanceDb = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

const SELECT = "id,date,payment_date,name,counterparty,amount,category,comment,company_id,status,import_source,opiu_allocation_id";
const LEGACY_SELECT = "id,date,name,counterparty,amount,category,comment,company_id,status,import_source";

export interface LoadedMonthlyDdsRows {
  rows: Record<string, unknown>[];
  periodAllocationAvailable: boolean;
}

function missingAllocationModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /opiu_dds_facts_for_month|schema cache|does not exist|could not find the function/i.test(message);
}

/**
 * Возвращает факты ОПиУ по периоду начисления. До применения миграции
 * сохраняет прежнее поведение по дате платежа, чтобы отчёт не становился пустым.
 */
export async function loadMonthlyDdsRows(db: FinanceDb, from: string, to: string, label: string): Promise<LoadedMonthlyDdsRows> {
  try {
    const rows = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
      .rpc("opiu_dds_facts_for_month", { p_from: from, p_to: to })
      .select(SELECT)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageTo) as unknown as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: { message: string } | null;
      }>, { label, maxPages: 100 });
    return { rows, periodAllocationAvailable: true };
  } catch (error) {
    if (!missingAllocationModel(error)) throw error;
    const rows = await loadAllSupabasePages<Record<string, unknown>>((pageFrom, pageTo) => db
      .from("payments")
      .select(LEGACY_SELECT)
      .eq("status", "done")
      .or("import_source.like.bank-review:%,import_source.like.dds-chain:%,import_source.like.manual-dds:%,import_source.like.dds-file:%")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageTo), { label: `${label}: резерв по дате платежа`, maxPages: 100 });
    return { rows, periodAllocationAvailable: false };
  }
}
