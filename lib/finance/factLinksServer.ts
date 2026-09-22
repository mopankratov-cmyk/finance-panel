import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { consumedFactIds } from "./factLinks";

/**
 * Серверный источник занятых фактов ДДС. Текстовые метки сохраняют
 * совместимость с календарём и зарплатой, а paid_by_payment_id защищает
 * канонические строки графика кредита даже после потери метки в comment.
 */
export async function loadConsumedFactIds(
  db: SupabaseClient,
  exceptPlanId?: string,
): Promise<Set<string>> {
  const [payments, scheduleRows] = await Promise.all([
    loadAllSupabasePages<{ id: string; comment: string | null }>(
      (from, to) => db.from("payments")
        .select("id,comment")
        .not("comment", "is", null)
        .like("comment", "%[%")
        .order("id", { ascending: true })
        .range(from, to),
      { label: "Связи планов с фактами ДДС", maxPages: 60 },
    ),
    loadAllSupabasePages<{ paid_by_payment_id: string | null }>(
      (from, to) => db.from("loan_schedule_rows")
        .select("paid_by_payment_id")
        .not("paid_by_payment_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
      { label: "Связи графика кредита с фактами", maxPages: 60 },
    ),
  ]);

  return consumedFactIds(
    payments,
    exceptPlanId,
    scheduleRows.map((row) => ({ paidByPaymentId: row.paid_by_payment_id })),
  );
}
