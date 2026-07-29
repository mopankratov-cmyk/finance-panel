import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";

export const dynamic = "force-dynamic";

export interface PurchaseReceiptRow {
  id: number;
  batchId: string;
  cabinetId: string;
  nmId: number;
  article: string;
  expectedQty: number;
  expectedAt: string | null;
  warehouse: string | null;
  receivedQty: number | null;
  receivedAt: string | null;
  status: "expected" | "received";
  source: "manual" | "moysklad";
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface DbRow {
  id: number;
  batch_id: string;
  cabinet_id: string;
  nm_id: number;
  article: string;
  expected_qty: number;
  expected_at: string | null;
  warehouse: string | null;
  received_qty: number | null;
  received_at: string | null;
  status: "expected" | "received";
  source: "manual" | "moysklad";
  note: string | null;
  created_by: string | null;
  created_at: string;
}

function toRow(r: DbRow): PurchaseReceiptRow {
  return {
    id: r.id,
    batchId: r.batch_id,
    cabinetId: r.cabinet_id,
    nmId: r.nm_id,
    article: r.article,
    expectedQty: r.expected_qty,
    expectedAt: r.expected_at,
    warehouse: r.warehouse,
    receivedQty: r.received_qty,
    receivedAt: r.received_at,
    status: r.status,
    source: r.source,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ data: null, error: "Нет доступа к кабинету" }, { status: 403 });
  }

  let q = db.from("purchase_receipts").select("*");
  if (p_cabinet) q = q.eq("cabinet_id", p_cabinet);
  const { data, error } = await q;
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r) => toRow(r as DbRow));
  const expected = rows.filter((r) => r.status === "expected")
    .sort((a, b) => (a.expectedAt || "9999").localeCompare(b.expectedAt || "9999") || a.createdAt.localeCompare(b.createdAt));
  const received = rows.filter((r) => r.status === "received")
    .sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));

  return NextResponse.json({ data: { expected, received }, error: null });
}

interface NewLine { nmId: number; article: string; expectedQty: number }

export async function POST(req: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as {
    cabinetId?: string; expectedAt?: string; warehouse?: string; note?: string; lines?: NewLine[];
  };
  const cabinetId = cabinetIdFromParam(body.cabinetId);
  if (!cabinetId) return NextResponse.json({ data: null, error: "Укажите корректный кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ data: null, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const lines = body.lines ?? [];
  if (!lines.length) return NextResponse.json({ data: null, error: "Добавьте хотя бы одну позицию" }, { status: 400 });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.nmId || !Number.isFinite(l.nmId) || l.nmId <= 0) return NextResponse.json({ data: null, error: `Строка ${i + 1}: некорректный nmId` }, { status: 400 });
    if (!l.expectedQty || !Number.isFinite(l.expectedQty) || l.expectedQty <= 0) return NextResponse.json({ data: null, error: `Строка ${i + 1}: количество должно быть больше 0` }, { status: 400 });
  }

  const session = await getServerSession();
  const batchId = crypto.randomUUID();
  const insertRows = lines.map((l) => ({
    batch_id: batchId,
    cabinet_id: cabinetId,
    nm_id: l.nmId,
    article: l.article || "",
    expected_qty: Math.round(l.expectedQty),
    expected_at: body.expectedAt || null,
    warehouse: body.warehouse || null,
    note: body.note || null,
    created_by: session?.email ?? null,
  }));

  const { data, error } = await db.from("purchase_receipts").insert(insertRows).select("*");
  if (error) return NextResponse.json({ data: null, error: error.message }, { status: 500 });

  return NextResponse.json({ data: { batchId, rows: (data ?? []).map((r) => toRow(r as DbRow)) }, error: null }, { status: 201 });
}
