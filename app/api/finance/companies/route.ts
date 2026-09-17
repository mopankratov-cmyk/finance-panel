import { listPaymentChains, loadPaymentChain, savePaymentChain } from "@/lib/finance/paymentChainsServer";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseCompanyTaxSystem, parseCompanyVatMode } from "@/lib/finance/companyTax";

import { COMPANY_TAX_UNAVAILABLE, isMissingCompanyTaxColumn, readCompaniesCompat } from "@/lib/finance/companySchema";

function companyResponse(row: Record<string, unknown>) {
  return {
    company: { id: row.id, name: row.name, group_name: row.group_name, is_active: row.is_active, tax_system: row.tax_system ?? null, vat_mode: row.vat_mode ?? null },
    tax_settings_available: "tax_system" in row && "vat_mode" in row,
  };
}

export const dynamic = "force-dynamic";

async function authorize() {
  return requireApiSession(["director", "fin_director", "financier"]);
}

export async function GET(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  if (request.nextUrl.searchParams.get("resource") === "payment-chain-index") {
    try {return NextResponse.json({chains:await listPaymentChains()});}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось загрузить исходные суммы"},{status:500});}
  }
  if (request.nextUrl.searchParams.get("resource") === "payment-chain") {
    try {return NextResponse.json(await loadPaymentChain({paymentId:request.nextUrl.searchParams.get("payment_id")??undefined,reviewId:request.nextUrl.searchParams.get("review_id")??undefined,chainId:request.nextUrl.searchParams.get("chain_id")??undefined}));}
    catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"Не удалось загрузить цепочку"},{status:(error as {status?:number}).status??500});}
  }
  const [loaded, links] = await Promise.all([
    readCompaniesCompat((columns) => db.from("companies").select(columns).order("group_name").order("name")),
    loadAllSupabasePages<{ id: string; company_id: string | null }>((from, to) => db
      .from("payments")
      .select("id,company_id")
      .order("id", { ascending: true })
      .range(from, to), { label: "Связи платежей с компаниями" }),
  ]);
  const companies = loaded.result;
  if (companies.error) return NextResponse.json({ error: companies.error.message }, { status: 500 });
  return NextResponse.json({
    companies: companies.data ?? [],
    payment_links: links,
    tax_settings_available: loaded.taxSettingsAvailable,
  });
}

export async function POST(request: NextRequest) {
  const gate = await authorize();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  if (action === "payment-chain") {
    try {return NextResponse.json(await savePaymentChain(body));}
    catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"Не удалось сохранить цепочку"},{status:(error as {status?:number}).status??500});}
  }
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
      .select("*")
      .single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json(companyResponse(result.data));
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
      import_source: payment.importSource == null ? null : String(payment.importSource),
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
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action === "company") {
    const companyId = String(body.company_id ?? "").trim();
    const hasTaxSettings = "tax_system" in body || "vat_mode" in body;
    const taxSystem = hasTaxSettings ? parseCompanyTaxSystem(body.tax_system) : null;
    const vatMode = hasTaxSettings ? parseCompanyVatMode(body.vat_mode) : null;
    if (!companyId) return NextResponse.json({ error: "Не указана компания" }, { status: 400 });
    if (typeof body.is_active !== "boolean") return NextResponse.json({ error: "Некорректный статус компании" }, { status: 400 });
    if (taxSystem === undefined) return NextResponse.json({ error: "Некорректная система налогообложения" }, { status: 400 });
    if (vatMode === undefined) return NextResponse.json({ error: "Некорректная настройка НДС" }, { status: 400 });
    const result = await db.from("companies")
      .update({ is_active: body.is_active, ...(hasTaxSettings ? { tax_system: taxSystem, vat_mode: vatMode } : {}) })
      .eq("id", companyId)
      .select("*")
      .maybeSingle();
    if (isMissingCompanyTaxColumn(result.error)) return NextResponse.json({ error: COMPANY_TAX_UNAVAILABLE }, { status: 503 });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    if (!result.data) return NextResponse.json({ error: "Компания не найдена" }, { status: 404 });
    return NextResponse.json(companyResponse(result.data));
  }
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
