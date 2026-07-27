import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type ReviewStatus = "ready" | "needs_info" | "waiting_manager" | "approved" | "rejected";
type SuggestionInput = {
  row?: {
    id?: string;
    date?: string;
    amount?: number;
    counterparty?: string;
    counterpartyInn?: string;
    purpose?: string;
  };
  companyId?: string | null;
  accountId?: string | null;
  category?: string | null;
  confidence?: number;
  reasons?: string[];
  needsReview?: boolean;
  transferCandidateId?: string | null;
};

const ACTIVE_STATUSES: ReviewStatus[] = ["ready", "needs_info", "waiting_manager"];
const ALL_STATUSES: ReviewStatus[] = [...ACTIVE_STATUSES, "approved", "rejected"];

function text(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return jsonError("Серверная база не настроена", 503);
  const resource = request.nextUrl.searchParams.get("resource") ?? "items";

  if (resource === "mappings") {
    const { data, error } = await db
      .from("bank_account_mappings")
      .select("bank_account_number,owner_inn,company_id,account_id");
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ mappings: data ?? [] });
  }

  const { data, error } = await db
    .from("bank_review_items")
    .select("*")
    .in("status", ACTIVE_STATUSES)
    .order("date", { ascending: false })
    .limit(5_000);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return jsonError("Серверная база не настроена", 503);
  const body = await request.json().catch(() => null) as {
    action?: string;
    statement?: {
      documentHash?: string;
      accountNumber?: string;
      ownerInn?: string;
    };
    suggestions?: SuggestionInput[];
    sourceFileName?: string;
    mapping?: {
      bankAccountNumber?: string;
      ownerInn?: string;
      companyId?: string;
      accountId?: string;
    };
  } | null;
  if (!body) return jsonError("Некорректный JSON", 400);

  if (body.action === "mapping") {
    const mapping = body.mapping;
    const bankAccountNumber = text(mapping?.bankAccountNumber, 40).replace(/\D/g, "");
    const ownerInn = text(mapping?.ownerInn, 20).replace(/\D/g, "");
    const companyId = text(mapping?.companyId, 100);
    const accountId = text(mapping?.accountId, 100);
    if (!bankAccountNumber || !companyId || !accountId) return jsonError("Не заполнено сопоставление счёта", 400);
    const { error } = await db.from("bank_account_mappings").upsert(
      {
        bank_account_number: bankAccountNumber,
        owner_inn: ownerInn,
        company_id: companyId,
        account_id: accountId,
      },
      { onConflict: "bank_account_number" },
    );
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "batch" || !body.statement || !Array.isArray(body.suggestions)) {
    return jsonError("Некорректная команда банковской очереди", 400);
  }
  if (body.suggestions.length > 10_000) return jsonError("В выписке слишком много операций", 413);

  const documentHash = text(body.statement.documentHash, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(documentHash)) return jsonError("Не удалось определить цифровой отпечаток выписки", 400);
  const bankAccountNumber = text(body.statement.accountNumber, 40).replace(/\D/g, "");
  const ownerInn = text(body.statement.ownerInn, 20).replace(/\D/g, "");
  const batchId = crypto.randomUUID();
  const rows = body.suggestions.flatMap((suggestion) => {
    const row = suggestion.row;
    const externalId = text(row?.id, 500);
    const date = text(row?.date, 10);
    const amount = Number(row?.amount);
    if (!externalId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount === 0) return [];
    return [{
      id: crypto.randomUUID(),
      batch_id: batchId,
      document_hash: documentHash,
      source_file_name: text(body.sourceFileName, 255) || "Банковская выписка",
      external_id: externalId,
      date,
      amount,
      bank_account_number: bankAccountNumber,
      owner_inn: ownerInn,
      company_id: text(suggestion.companyId, 100) || null,
      account_id: text(suggestion.accountId, 100) || null,
      counterparty: text(row?.counterparty),
      counterparty_inn: text(row?.counterpartyInn, 20).replace(/\D/g, ""),
      purpose: text(row?.purpose, 5_000),
      category: text(suggestion.category, 255) || null,
      confidence: Math.min(1, Math.max(0, Number(suggestion.confidence) || 0)),
      reasons: Array.isArray(suggestion.reasons) ? suggestion.reasons.slice(0, 20).map((reason) => text(reason, 500)) : [],
      status: suggestion.needsReview ? "needs_info" : "ready",
      matched_transfer_id: null,
    }];
  });
  if (!rows.length) return NextResponse.json({ queued: 0 });

  const { data, error } = await db
    .from("bank_review_items")
    .upsert(rows, {
      onConflict: "document_hash,external_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ queued: data?.length ?? 0 });
}

export async function PATCH(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return jsonError("Серверная база не настроена", 503);
  const body = await request.json().catch(() => null) as {
    action?: string;
    id?: string;
    ids?: string[];
    status?: ReviewStatus;
    patch?: Record<string, unknown>;
  } | null;
  if (!body) return jsonError("Некорректный JSON", 400);

  if (body.action === "mark") {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 1_000).map((id) => text(id, 100)).filter(Boolean) : [];
    if (!ids.length || !["approved", "rejected"].includes(body.status ?? "")) {
      return jsonError("Некорректный список или статус", 400);
    }
    const { error } = await db
      .from("bank_review_items")
      .update({ status: body.status })
      .in("id", ids)
      .in("status", ACTIVE_STATUSES);
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "update" || !body.id || !body.patch) return jsonError("Некорректное изменение", 400);
  const patch: Record<string, unknown> = {};
  if ("companyId" in body.patch) patch.company_id = text(body.patch.companyId, 100) || null;
  if ("accountId" in body.patch) patch.account_id = text(body.patch.accountId, 100) || null;
  if ("category" in body.patch) patch.category = text(body.patch.category, 255) || null;
  if ("counterparty" in body.patch) patch.counterparty = text(body.patch.counterparty);
  if ("managerQuestion" in body.patch) patch.manager_question = text(body.patch.managerQuestion);
  if ("managerAnswer" in body.patch) patch.manager_answer = text(body.patch.managerAnswer);
  if ("status" in body.patch) {
    const status = text(body.patch.status, 30) as ReviewStatus;
    if (!ALL_STATUSES.includes(status)) return jsonError("Некорректный статус", 400);
    patch.status = status;
  }
  if (!Object.keys(patch).length) return jsonError("Нет разрешённых полей для изменения", 400);
  const { error } = await db
    .from("bank_review_items")
    .update(patch)
    .eq("id", text(body.id, 100))
    .in("status", ACTIVE_STATUSES);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
