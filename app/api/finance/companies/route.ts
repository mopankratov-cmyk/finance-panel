import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function authorize() {
  return requireApiSession(["director", "finance"]);
}

export async function GET() {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const [companies, links] = await Promise.all([
    db.from("companies").select("id,name,group_name,is_active").order("group_name").order("name"),
    loadAllSupabasePages<{ id: string; company_id: string | null }>((from, to) => db
      .from("payments")
      .select("id,company_id")
      .order("id", { ascending: true })
      .range(from, to), { label: "Связи платежей с компаниями" }),
  ]);
  if (companies.error) return NextResponse.json({ error: companies.error.message }, { status: 500 });
  return NextResponse.json({
    companies: companies.data ?? [],
    payment_links: links,
  });
}

export async function POST(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  if (action === "create") {
    const name = String(body.name ?? "").trim();
    const groupName = String(body.group_name ?? "").trim();
    if (!name || !groupName || name.length > 160 || groupName.length > 160) {
      return NextResponse.json({ error: "Укажите название юрлица и группу" }, { status: 400 });
    }
    const existing = await db.from("companies").select("id").ilike("name", name).limit(1);
    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
    if ((existing.data ?? []).length) return NextResponse.json({ error: "Юрлицо с таким названием уже существует" }, { status: 409 });
    const result = await db.from("companies")
      .insert({ name, group_name: groupName, is_active: true })
      .select("id,name,group_name,is_active")
      .single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ company: result.data });
  }
  if (action === "payment") {
    const payment = body.payment && typeof body.payment === "object" ? body.payment as Record<string, unknown> : null;
    // Пустая компания — легальное состояние «Общее по группе», а не ошибка.
    const companyId = String(body.company_id ?? "").trim();
    if (!payment) return NextResponse.json({ error: "Некорректный платёж" }, { status: 400 });
    const amount = Number(payment.amount);
    if (!String(payment.id ?? "") || !Number.isFinite(amount)) return NextResponse.json({ error: "Некорректный платёж" }, { status: 400 });
    const result = await db.from("payments").upsert({
      id: String(payment.id),
      name: String(payment.name ?? ""),
      amount,
      type: amount >= 0 ? "income" : "expense",
      category: String(payment.category ?? ""),
      account_id: String(payment.accountId ?? ""),
      date: String(payment.date ?? ""),
      status: String(payment.status ?? "planned"),
      counterparty: String(payment.counterparty ?? ""),
      comment: payment.comment == null ? null : String(payment.comment),
      company_id: companyId || null,
    });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await request.json().catch(() => ({})) as { payment_id?: string; company_id?: string | null };
  const paymentId = String(body.payment_id ?? "");
  if (!paymentId) return NextResponse.json({ error: "Не указан платёж" }, { status: 400 });
  const result = await db.from("payments")
    .update({ company_id: body.company_id || null })
    .eq("id", paymentId)
    .select("id");
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  if (!(result.data ?? []).length) return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
