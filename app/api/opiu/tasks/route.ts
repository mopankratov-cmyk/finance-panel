import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";

const telegramHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET() {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  const { data, error } = await db
    .from("finance_tasks")
    .select("id,text,status,source,author_name,result_text,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function PATCH(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  const body = await request.json() as { id?: number; status?: string; resultText?: string; action?: string };
  if (!body.id) {
    return NextResponse.json({ error: "Некорректная задача или статус" }, { status: 400 });
  }
  if (body.action === "move_to_payment_answer") {
    const task = await db.from("finance_tasks").select("id,text").eq("id", body.id).maybeSingle();
    if (task.error) return NextResponse.json({ error: task.error.message }, { status: 500 });
    if (!task.data) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    const pending = await db.from("bank_review_items")
      .select("id,reasons")
      .eq("status", "waiting_manager")
      .limit(5_000);
    if (pending.error) return NextResponse.json({ error: pending.error.message }, { status: 500 });
    const latest = (pending.data ?? []).map((item) => ({
      item,
      messageId: Math.max(...(Array.isArray(item.reasons) ? item.reasons.map(String).filter((reason) => reason.startsWith("__telegram_message_id:")).map((reason) => Number(reason.slice("__telegram_message_id:".length))) : []), -1),
    })).sort((left, right) => right.messageId - left.messageId)[0]?.item;
    if (!latest) return NextResponse.json({ error: "Нет платежа, ожидающего ответа руководителя" }, { status: 409 });
    const reasons = Array.isArray(latest.reasons)
      ? [...latest.reasons.map(String).filter((reason) => !reason.startsWith("__telegram_message_id:")), "Ответ перенесён из задач руководителя"]
      : ["Ответ перенесён из задач руководителя"];
    const update = await db.from("bank_review_items").update({ manager_answer: task.data.text, status: "needs_info", reasons }).eq("id", latest.id).eq("status", "waiting_manager");
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    const removal = await db.from("finance_tasks").delete().eq("id", task.data.id);
    if (removal.error) return NextResponse.json({ error: removal.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (!["new", "in_progress", "done", "cancelled"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Некорректная задача или статус" }, { status: 400 });
  }
  const { error } = await db.from("finance_tasks").update({
    status: body.status,
    result_text: body.resultText?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (body.resultText?.trim()) {
    const chatId = process.env.FINANCE_TELEGRAM_CHAT_ID;
    if (chatId) await sendTelegramMessage(`✅ <b>Ответ финансовой команды</b>\n${telegramHtml(body.resultText.trim())}`, chatId);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Серверная база не настроена" }, { status: 503 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  const { error } = await db.from("finance_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
