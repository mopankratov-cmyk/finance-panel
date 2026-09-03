import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const text = (value: unknown, max = 2000) => String(value ?? "").trim().slice(0, max);
const nullableId = (value: unknown) => text(value, 80) || null;

async function directorGate() {
  return requireApiSession(["director"]);
}

export async function GET() {
  const gate = await directorGate();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const result = await db.from("payroll_employee_private").select("employee_id,bank_name,phone,work_email,birth_date,settlement_account_details,card_transfer_details,payment_details,payment_details_masked,passport_ref").order("employee_id");
  if (result.error) {
    if (/does not exist|schema cache/i.test(result.error.message)) return NextResponse.json({ privateRows: [], preview: true });
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json({ privateRows: result.data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await directorGate();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const action = text(body.action, 40);

  if (action === "save_private") {
    const employeeId = nullableId(body.employeeId);
    const source = body.private && typeof body.private === "object" ? body.private as Record<string, unknown> : null;
    if (!employeeId || !source) return NextResponse.json({ error: "Не выбран сотрудник" }, { status: 400 });
    const result = await db.from("payroll_employee_private").upsert({
      employee_id: employeeId,
      bank_name: text(source.bankName, 120) || null,
      phone: text(source.phone, 120) || null,
      work_email: text(source.workEmail, 200) || null,
      birth_date: nullableId(source.birthDate),
      settlement_account_details: text(source.settlementAccountDetails) || null,
      card_transfer_details: text(source.cardTransferDetails, 1000) || null,
      payment_details: text(source.paymentDetails, 1000) || null,
      payment_details_masked: text(source.paymentDetailsMasked, 200) || null,
      passport_ref: text(source.passportRef, 500) || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "employee_id" }).select("employee_id").single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "import_private") {
    const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : [];
    if (!records.length || records.length > 500) return NextResponse.json({ error: "Файл не содержит реквизитов сотрудников" }, { status: 400 });
    const names = records.map((record) => text(record.fullName, 200)).filter(Boolean);
    const employees = await db.from("payroll_employees").select("id,full_name").in("full_name", names);
    if (employees.error) return NextResponse.json({ error: employees.error.message }, { status: 500 });
    const idByName = new Map((employees.data ?? []).map((employee) => [String(employee.full_name), String(employee.id)]));
    const rows = records.flatMap((source) => {
      const employeeId = idByName.get(text(source.fullName, 200));
      if (!employeeId) return [];
      return [{
        employee_id: employeeId,
        bank_name: text(source.bankName, 120) || null,
        phone: text(source.phone, 120) || null,
        work_email: text(source.workEmail, 200) || null,
        birth_date: nullableId(source.birthDate),
        settlement_account_details: text(source.settlementAccountDetails) || null,
        card_transfer_details: text(source.cardTransferDetails, 1000) || null,
        payment_details: text(source.paymentDetails, 1000) || null,
        payment_details_masked: text(source.paymentDetailsMasked, 200) || null,
        updated_at: new Date().toISOString(),
      }];
    });
    if (rows.length) {
      const result = await db.from("payroll_employee_private").upsert(rows, { onConflict: "employee_id" });
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ updated: rows.length, skipped: records.length - rows.length });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
