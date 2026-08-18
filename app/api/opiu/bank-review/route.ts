import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { findCertainTransferPairs } from "@/lib/opiu/bankTransferMatching";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";

type ReviewStatus = "ready" | "needs_info" | "waiting_manager" | "approved" | "rejected";
type SuggestionInput = {
  row?: {
    id?: string;
    date?: string;
    amount?: number;
    counterparty?: string;
    counterpartyInn?: string;
    counterpartyAccount?: string;
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
const COUNTERPARTY_ACCOUNT_MARKER = "__counterparty_account:";

function text(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function marker(reasons: unknown, prefix: string) {
  if (!Array.isArray(reasons)) return "";
  const value = reasons.find((reason) => typeof reason === "string" && reason.startsWith(prefix));
  return typeof value === "string" ? value.slice(prefix.length).replace(/\D/g, "") : "";
}

const telegramHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

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

  if (resource === "google-sync") {
    const [items, payments] = await Promise.all([
      db.from("bank_review_items")
        .select("*")
        .in("status", ACTIVE_STATUSES)
        .order("date", { ascending: true })
        .limit(5_000),
      db.from("payments")
        .select("id,import_source")
        .like("import_source", "bank-review:%")
        .limit(20_000),
    ]);
    if (items.error) return jsonError(items.error.message, 500);
    if (payments.error) return jsonError(payments.error.message, 500);
    return NextResponse.json({ items: items.data ?? [], payment_sources: payments.data ?? [] });
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
      reasons: [
        ...(Array.isArray(suggestion.reasons) ? suggestion.reasons.slice(0, 19).map((reason) => text(reason, 500)) : []),
        `${COUNTERPARTY_ACCOUNT_MARKER}${text(row?.counterpartyAccount, 40).replace(/\D/g, "")}`,
      ],
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
  const [active, companies] = await Promise.all([
    db.from("bank_review_items")
      .select("id,date,amount,bank_account_number,owner_inn,counterparty_inn,reasons,company_id,account_id,category,matched_transfer_id")
      .in("status", ACTIVE_STATUSES)
      .is("matched_transfer_id", null)
      .limit(5_000),
    db.from("companies").select("id,group_name"),
  ]);
  if (active.error) return jsonError(active.error.message, 500);
  if (companies.error) return jsonError(companies.error.message, 500);
  const activeRows = active.data ?? [];
  const byId = new Map(activeRows.map((row) => [row.id, row]));
  const groupByCompany = new Map((companies.data ?? []).map((company) => [company.id, company.group_name]));
  const pairs = findCertainTransferPairs(activeRows.map((row) => ({
    id: row.id,
    date: row.date,
    amount: Number(row.amount),
    bankAccountNumber: row.bank_account_number ?? "",
    ownerInn: row.owner_inn ?? "",
    counterpartyAccount: marker(row.reasons, COUNTERPARTY_ACCOUNT_MARKER),
    counterpartyInn: row.counterparty_inn ?? "",
  })));
  for (const pair of pairs) {
    const outgoing = byId.get(pair.outgoingId);
    const incoming = byId.get(pair.incomingId);
    if (!outgoing || !incoming) continue;
    const sameGroup = outgoing.company_id && incoming.company_id
      && groupByCompany.get(outgoing.company_id) === groupByCompany.get(incoming.company_id);
    const outgoingCategory = sameGroup ? "Выбытие — Перевод между счетами" : outgoing.category;
    const incomingCategory = sameGroup ? "Поступление — Перевод между счетами" : incoming.category;
    const updates = await Promise.all([
      db.from("bank_review_items").update({
        matched_transfer_id: incoming.id,
        category: outgoingCategory,
        status: outgoing.company_id && outgoing.account_id && outgoingCategory ? "ready" : "needs_info",
      }).eq("id", outgoing.id).is("matched_transfer_id", null),
      db.from("bank_review_items").update({
        matched_transfer_id: outgoing.id,
        category: incomingCategory,
        status: incoming.company_id && incoming.account_id && incomingCategory ? "ready" : "needs_info",
      }).eq("id", incoming.id).is("matched_transfer_id", null),
    ]);
    const updateError = updates.find((update) => update.error)?.error;
    if (updateError) return jsonError(updateError.message, 500);
  }

  return NextResponse.json({ queued: data?.length ?? 0, matchedTransfers: pairs.length });
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

  if (body.action === "ask_manager") {
    const id = text(body.id, 100);
    const question = text((body as { question?: unknown }).question, 2_000);
    if (!id || !question) return jsonError("Не указан платёж или вопрос", 400);
    const item = await db.from("bank_review_items")
      .select("id,date,amount,counterparty,counterparty_inn,purpose,source_file_name,bank_account_number,owner_inn,account_id,company_id,reasons")
      .eq("id", id)
      .in("status", ACTIVE_STATUSES)
      .maybeSingle();
    if (item.error) return jsonError(item.error.message, 500);
    if (!item.data) return jsonError("Платёж на проверке не найден", 404);
    const [account, company] = await Promise.all([
      item.data.account_id ? db.from("accounts").select("name").eq("id", item.data.account_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      item.data.company_id ? db.from("companies").select("name").eq("id", item.data.company_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (account.error) return jsonError(account.error.message, 500);
    if (company.error) return jsonError(company.error.message, 500);
    const updated = await db.from("bank_review_items").update({
      manager_question: question,
      manager_answer: null,
      status: "waiting_manager",
    }).eq("id", item.data.id).in("status", ACTIVE_STATUSES);
    if (updated.error) return jsonError(updated.error.message, 500);
    try {
      const telegramMessageId = await sendTelegramMessage([
        "❓ <b>Нужно пояснить платёж</b>",
        `Дата: ${telegramHtml(item.data.date)}`,
        `Сумма: ${Number(item.data.amount).toLocaleString("ru-RU")} ₽`,
        `Юрлицо: ${telegramHtml(company.data?.name || "ещё не определено")}`,
        `Банк / кошелёк: ${telegramHtml(account.data?.name || "ещё не определён")}`,
        `Расчётный счёт: ${telegramHtml(item.data.bank_account_number || "не указан")}`,
        `ИНН владельца: ${telegramHtml(item.data.owner_inn || "не указан")}`,
        `Контрагент: ${telegramHtml(item.data.counterparty || "не указан")}`,
        `ИНН контрагента: ${telegramHtml(item.data.counterparty_inn || "не указан")}`,
        `Комментарий банка: ${telegramHtml(item.data.purpose || "не указан")}`,
        `Файл выписки: ${telegramHtml(item.data.source_file_name || "не указан")}`,
        `Вопрос: <b>${telegramHtml(question)}</b>`,
        "",
        "Нажмите «Ответить» на это сообщение и напишите пояснение или отправьте голосовое.",
      ].join("\n"), undefined, { forceReply: true });
      if (telegramMessageId) {
        const currentReasons = Array.isArray(item.data.reasons)
          ? item.data.reasons.map(String).filter((reason) => !reason.startsWith("__telegram_message_id:"))
          : [];
        const marker = `__telegram_message_id:${telegramMessageId}`;
        const markerUpdate = await db.from("bank_review_items").update({ reasons: [...currentReasons, marker] }).eq("id", item.data.id);
        if (markerUpdate.error) return jsonError(markerUpdate.error.message, 500);
      }
    } catch (error) {
      await db.from("bank_review_items").update({ status: "needs_info" }).eq("id", item.data.id);
      return jsonError(error instanceof Error ? error.message : "Не удалось отправить вопрос в Telegram", 502);
    }
    return NextResponse.json({ ok: true });
  }

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
