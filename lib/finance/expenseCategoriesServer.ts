import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { DdsExpenseCategory } from "./expenseCategories";

export async function loadDdsExpenseCategories(): Promise<{ categories: DdsExpenseCategory[]; ready: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  try {
    const rows = await loadAllSupabasePages<{ id: string; name: string; opiu_article_id: string | null }>((from, to) => db
      .from("finance_expense_categories")
      .select("id,name,opiu_article_id")
      .order("name").order("id").range(from, to), { label: "Добавленные статьи ДДС", maxPages: 10 });
    return { categories: rows.map((row) => ({ id: row.id, name: row.name, opiuArticleId: row.opiu_article_id })), ready: true };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "42P01" || code === "PGRST205" || /Could not find the table 'public\.finance_expense_categories'|relation "(?:public\.)?finance_expense_categories" does not exist/.test(message)) {
      return { categories: [], ready: false };
    }
    throw error;
  }
}
