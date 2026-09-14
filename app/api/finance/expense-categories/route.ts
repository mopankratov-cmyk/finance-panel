import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { validateExpenseCategory } from "@/lib/finance/expenseCategories";
import { loadDdsExpenseCategories } from "@/lib/finance/expenseCategoriesServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    return NextResponse.json(await loadDdsExpenseCategories());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить статьи ДДС" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  let category: ReturnType<typeof validateExpenseCategory>;
  try { category = validateExpenseCategory(body); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const result = await db.from("finance_expense_categories")
    .insert({ name: category.name, opiu_article_id: category.opiuArticleId })
    .select("id,name,opiu_article_id").single();
  if (result.error) return NextResponse.json({ error: result.error.code === "23505" ? "Такая статья уже существует" : result.error.message }, { status: result.error.code === "23505" ? 409 : 502 });
  return NextResponse.json({ category: { id: result.data.id, name: result.data.name, opiuArticleId: result.data.opiu_article_id } }, { status: 201 });
}
