import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { matchBankReviewTransfers } from "@/lib/opiu/bankReviewTransfersServer";
import { mandatoryBankCategory } from "@/lib/opiu/bankPaymentRules";
import { categoryMatchesDirection, requiresCounterparty } from "@/components/payments/bankAutoClassify";
import { companyAliasKeys } from "@/lib/finance/companyAliases";
import { findCertainTransferPairs } from "@/lib/opiu/bankTransferMatching";
import { transferCategories } from "@/lib/opiu/bankTransferClassification";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { audit } from "@/lib/audit/log";

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
  categoryConfirmed?: boolean;
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

// Миграция ещё не применена в этом окружении — та же проверка кодов, что и в
// соседних роутах (см. app/api/warehouse/receipts/correct/route.ts).
const missingMigration = (code?: string) =>
  ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");


const telegramHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
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
    // Без листания PostgREST молча отдаёт первую тысячу — .limit(5000) не помогает.
    try {
      const [items, payments] = await Promise.all([
        loadAllSupabasePages<Record<string, unknown>>((from, to) => db
          .from("bank_review_items")
          .select("*")
          .in("status", ACTIVE_STATUSES)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to), { label: "Очередь выписок для Google" }),
        loadAllSupabasePages<{ id: string; import_source: string | null }>((from, to) => db
          .from("payments")
          .select("id,import_source")
          .like("import_source", "bank-review:%")
          .order("id", { ascending: true })
          .range(from, to), { label: "Платежи из выписок", maxPages: 60 }),
      ]);
      return NextResponse.json({ items, payment_sources: payments });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Не удалось прочитать очередь", 500);
    }
  }

  try {
    const items = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db
      .from("bank_review_items")
      .select("*")
      .in("status", resource === "transfers" ? [...ACTIVE_STATUSES,"approved"] : ACTIVE_STATUSES)
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to), { label: "Очередь выписок" });
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось прочитать очередь", 500);
  }
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return jsonError("Серверная база не настроена", 503);
  const body = await request.json().catch(() => null) as {
    action?: string;
    outgoingId?: string;
    incomingId?: string;
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

  if (body.action === "link_transfer") {
    const found = await db.from("bank_review_items").select("*").in("id",[text(body.outgoingId,100),text(body.incomingId,100)]);
    if(found.error) return jsonError(found.error.message,500);
    const rows = found.data ?? [];
    const pair = findCertainTransferPairs(rows.map(row => ({id:row.id,date:row.date,amount:Number(row.amount),bankAccountNumber:row.bank_account_number ?? "",ownerInn:row.owner_inn ?? "",counterpartyInn:row.counterparty_inn ?? "",counterpartyAccount:(Array.isArray(row.reasons)?row.reasons:[]).find((r:string)=>r.startsWith(COUNTERPARTY_ACCOUNT_MARKER))?.slice(COUNTERPARTY_ACCOUNT_MARKER.length) ?? ""})))[0];
    if(!pair || pair.outgoingId!==body.outgoingId || pair.incomingId!==body.incomingId) return jsonError("Сумма, даты и реквизиты не подтверждают этот перевод",400);
    const categories=transferCategories(rows.find(r=>r.id===pair.outgoingId)?.company_id ?? null,rows.find(r=>r.id===pair.incomingId)?.company_id ?? null);
    const linked=await db.rpc("link_bank_review_transfer",{p_outgoing:pair.outgoingId,p_incoming:pair.incomingId,p_outgoing_category:categories.outgoing,p_incoming_category:categories.incoming});
    if(linked.error)return jsonError(linked.error.message,400);
    return NextResponse.json({ok:true});
  }

  if (body.action === "match_transfers") {
    try { return NextResponse.json({ matchedTransfers: await matchBankReviewTransfers() }); }
    catch (error) { return jsonError(error instanceof Error ? error.message : "Не удалось связать выписки", 500); }
  }

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
      category: mandatoryBankCategory({amount,counterpartyInn:row?.counterpartyInn,purpose:row?.purpose}) ?? (text(suggestion.category, 255) || null),
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

  // Стейл или опечатанный id (например, у клиента с устаревшим кэшем списка
  // компаний) иначе тихо создаёт строку очереди со ссылкой на несуществующую
  // компанию/счёт — платёж повиснет без ошибки и без объяснения почему.
  const distinctCompanyIds = Array.from(new Set(rows.map((row) => row.company_id).filter((id): id is string => Boolean(id))));
  const distinctAccountIds = Array.from(new Set(rows.map((row) => row.account_id).filter((id): id is string => Boolean(id))));
  if (distinctCompanyIds.length) {
    const { data: foundCompanies, error: companiesError } = await db.from("companies").select("id").in("id", distinctCompanyIds);
    if (companiesError) return jsonError(companiesError.message, 500);
    const foundCompanyIds = new Set((foundCompanies ?? []).map((row) => row.id));
    const missingCompanyIds = distinctCompanyIds.filter((id) => !foundCompanyIds.has(id));
    if (missingCompanyIds.length) return jsonError(`Компания не найдена в справочнике: ${missingCompanyIds.join(", ")}`, 400);
  }
  if (distinctAccountIds.length) {
    const { data: foundAccounts, error: accountsError } = await db.from("accounts").select("id").in("id", distinctAccountIds);
    if (accountsError) return jsonError(accountsError.message, 500);
    const foundAccountIds = new Set((foundAccounts ?? []).map((row) => row.id));
    const missingAccountIds = distinctAccountIds.filter((id) => !foundAccountIds.has(id));
    if (missingAccountIds.length) return jsonError(`Счёт не найден в справочнике: ${missingAccountIds.join(", ")}`, 400);
  }

  const { data, error } = await db
    .from("bank_review_items")
    .upsert(rows, {
      onConflict: "document_hash,external_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) return jsonError(error.message, 500);
  try {
    const matchedTransfers = await matchBankReviewTransfers();
    const explicitIds = new Set(body.suggestions.filter(s => s.categoryConfirmed).map(s => text(s.row?.id,500)));
    const names = await loadAllSupabasePages<{id:string;name:string}>((from,to)=>db.from("companies").select("id,name").order("id").range(from,to),{label:"Компании выписок"});
    const stored = await loadAllSupabasePages<{id:string;external_id:string;amount:number;counterparty:string;purpose:string;company_id:string|null;account_id:string|null;category:string|null;status:ReviewStatus;manager_answer:string|null}>((from,to)=>db.from("bank_review_items").select("id,external_id,amount,counterparty,purpose,company_id,account_id,category,status,manager_answer").eq("document_hash",documentHash).order("id").range(from,to),{label:"Сохранённые строки выписки"});
    const selectedExternalIds=new Set(rows.map(row=>row.external_id));
    const companyNames = new Map(names.map(c => [c.id,c.name]));
    const confirmIds = stored.filter(row => {
      const recipientAliases = companyAliasKeys(row.counterparty + " " + row.purpose);
      const sourceName = companyNames.get(row.company_id ?? "") ?? "";
      const needsCashChain = row.amount < 0 && /основн|рио|митриченко|панкратов|кучеренко/i.test(sourceName) && recipientAliases.length > 0;
      return selectedExternalIds.has(row.external_id) && ["ready","needs_info"].includes(row.status) && !row.manager_answer && explicitIds.has(row.external_id) && !needsCashChain
        && row.company_id && row.account_id && row.category && categoryMatchesDirection(row.category,row.amount)
        && (!requiresCounterparty(row.category) || row.counterparty.trim());
    }).map(row => row.id);
    const confirmed = confirmIds.length ? await db.rpc("confirm_bank_review_items",{p_ids:confirmIds}) : {data:0,error:null};
    if(confirmed.error) return jsonError(confirmed.error.message,500);
    const confirmedSet=new Set(confirmIds);
    return NextResponse.json({ queued: stored.filter(row=>selectedExternalIds.has(row.external_id)&&ACTIVE_STATUSES.includes(row.status)&&!confirmedSet.has(row.id)).length, approved: Number(confirmed.data ?? 0), matchedTransfers });
  } catch(error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось связать выписки. Проверьте миграцию 202609140003_bank_review_confirm_and_link.sql",500);
  }
}

export async function PATCH(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
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
        `❓ <b>${telegramHtml(question)}</b>`,
        "",
        `<b>${telegramHtml(item.data.date)} · ${Number(item.data.amount).toLocaleString("ru-RU")} ₽</b>`,
        `<b>Со счёта:</b> ${telegramHtml(company.data?.name || "юрлицо ещё не определено")} · ${telegramHtml(account.data?.name || "банк не определён")}`,
        `<b>Контрагент:</b> ${telegramHtml(item.data.counterparty || "не указан")}`,
        `<b>Назначение банка:</b> ${telegramHtml(item.data.purpose || "не указано")}`,
        "",
        "<b>Дополнительные реквизиты</b>",
        `Расчётный счёт: ${telegramHtml(item.data.bank_account_number || "не указан")}`,
        `ИНН владельца / контрагента: ${telegramHtml(item.data.owner_inn || "—")} / ${telegramHtml(item.data.counterparty_inn || "—")}`,
        `Файл: ${telegramHtml(item.data.source_file_name || "не указан")}`,
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

  // Тот же риск, что и в POST "batch": стейл или опечатанный id иначе тихо
  // привязывает строку очереди к несуществующей компании/счёту.
  if (typeof patch.company_id === "string" && patch.company_id) {
    const { data: company, error: companyError } = await db.from("companies").select("id").eq("id", patch.company_id).maybeSingle();
    if (companyError) return jsonError(companyError.message, 500);
    if (!company) return jsonError(`Компания не найдена в справочнике: ${patch.company_id}`, 400);
  }
  if (typeof patch.account_id === "string" && patch.account_id) {
    const { data: account, error: accountError } = await db.from("accounts").select("id").eq("id", patch.account_id).maybeSingle();
    if (accountError) return jsonError(accountError.message, 500);
    if (!account) return jsonError(`Счёт не найден в справочнике: ${patch.account_id}`, 400);
  }

  const { error } = await db
    .from("bank_review_items")
    .update(patch)
    .eq("id", text(body.id, 100))
    .in("status", ACTIVE_STATUSES);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return jsonError("Серверная база не настроена", 503);
  const body = await request.json().catch(() => null) as { confirm?: string } | null;
  // Необратимая массовая зачистка импорта — без явного подтверждения от вызывающего не выполняем.
  if (body?.confirm !== "CLEAR_BANK_IMPORT") {
    return jsonError("Подтвердите удаление", 400);
  }
  let paymentIds: string[];
  let reviewRows: { id: string; date: string }[];
  try {
    paymentIds = (await loadAllSupabasePages<{ id: string }>((from, to) => db.from("payments").select("id").like("import_source", "bank-review:%").order("id", { ascending: true }).range(from, to), { label: "Платежи из выписок", maxPages: 60 })).map((row) => row.id);
    reviewRows = await loadAllSupabasePages<{ id: string; date: string }>((from, to) => db.from("bank_review_items").select("id,date").order("id", { ascending: true }).range(from, to), { label: "Очередь выписок", maxPages: 60 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось прочитать очередь", 500);
  }
  const reviewIds = reviewRows.map((row) => row.id);
  const dates = reviewRows.map((row) => row.date).filter(Boolean).sort();

  // Пишем журнал ДО удаления: если сам rpc-вызов не дойдёт или оборвётся сеть,
  // запись о том, что и в каком объёме собирались снести, всё равно останется.
  await audit(request, await getServerSession(), {
    action: "bank_review.clear",
    subject: `выписки: ${reviewIds.length}, платежи ДДС: ${paymentIds.length}`,
    before: {
      reviewItemsCount: reviewIds.length,
      paymentsCount: paymentIds.length,
      dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    },
  });

  // Обе фазы одним вызовом: bank_review_clear_import — SQL-функция, значит одна
  // неявная транзакция. Раньше здесь было два отдельных цикла .delete().in(...)
  // (сначала payments, потом bank_review_items, пачками по 300 из-за длины URL
  // PostgREST) — обрыв сети/базы между ними или между пачками оставлял чистку
  // наполовину применённой. Список id теперь едет параметром массива в теле
  // rpc-вызова, а не в query string, так что батчинг по 300 тоже не нужен.
  const cleared = await db.rpc("bank_review_clear_import", {
    p_payment_ids: paymentIds,
    p_review_ids: reviewIds,
  });
  if (cleared.error) {
    if (missingMigration(cleared.error.code) || /does not exist|schema cache/i.test(cleared.error.message)) {
      return jsonError("Примените миграцию 202609130008_bank_review_clear_import_atomic.sql", 503);
    }
    return jsonError(cleared.error.message, 500);
  }
  return NextResponse.json({ reviewItemsDeleted: reviewIds.length, paymentsDeleted: paymentIds.length });
}
