import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClaudeClient } from "@/lib/agent/client";
import { internalFetch } from "@/lib/internalFetch";
import { transcribeFal } from "@/lib/factory/asr";
import { tgReady, tgOwnerChat, tgWebhookSecret, tgSetWebhook, tgFileUrl, tgAnswerCallback, tgSendMessage } from "@/lib/factory/telegram";
import { extractJson } from "@/lib/factory/extractJson";
import { parseVoiceTelegramSelection } from "@/lib/factory/voiceLearningLoop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// R5 · Telegram-вебхук заводского бота: голос-ревью + кнопки ✓Беру/✕Не то → петля одобрения.
//   GET  ?setup=https://<prod>  → зарегистрировать вебхук (владелец, 1 раз после деплоя)
//   GET                         → статус (ready/owner)
//   POST                        → апдейт Telegram (callback кнопок / голос / текст)
// Безопасность: секрет в заголовке (от Telegram) + chat_id == FACTORY_TG_CHAT_ID (только владелец).

export async function GET(req: NextRequest) {
  try {
  const setup = req.nextUrl.searchParams.get("setup");
  if (setup) {
    if (!tgReady()) return NextResponse.json({ ok: false, error: "FACTORY_TG_BOT_TOKEN не настроен в Vercel" });
    const r = await tgSetWebhook(setup);
    return NextResponse.json({ ok: !!r?.ok, setWebhook: r, note: "напиши боту /start чтобы получить chat_id" });
  }
  return NextResponse.json({ ok: true, ready: tgReady(), owner_set: !!tgOwnerChat() });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      ready: false,
      owner_set: false,
      error: "telegram GET crash: " + String((e as Error)?.message || e).slice(0, 160),
    });
  }
}

// применить вердикт оператора к рецепту: approve→/winners, reject→/reject

async function applyVerdict(origin: string, db: any, recipeId: number, verdict: string, reason: string): Promise<string> {
  let url: string | null = null, article = "", niche = "", hook = "";
  try {
    const { data } = await db.from("node_recipes").select("article,niche,output_url,run_plan").eq("id", recipeId).limit(1);
    const rec = (data as Record<string, unknown>[] | null)?.[0];
    if (rec) {
      url = (rec.output_url as string) || null; article = (rec.article as string) || ""; niche = (rec.niche as string) || "";
      const nodes = (((rec.run_plan as Record<string, unknown>)?.nodes) as Record<string, unknown>[]) || [];
      const h = nodes.find((n) => String((n.params as Record<string, unknown>)?.role || n.slot || "").toLowerCase() === "hook") || nodes[0];
      hook = String((h?.onscreen_text as string) || (h?.prompt as string) || article || "").slice(0, 200);
    }
  } catch { /* рецепт мог не найтись */ }
  const post = async (path: string, body: unknown) => { try { const r = await internalFetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); return await r.json().catch(() => null); } catch { return null; } };
  if (verdict === "approve") {
    const r = await post("/api/factory/winners", { url, hook, note: "одобрено в Telegram" });
    if (r && !r.error) return `✓ Беру — в банк, хук в корпус победителей.`;
    return `⚠ Не записал в winners: ${r?.error || (url ? "ролик не найден в каталоге" : "у рецепта нет url")}. Возможно ещё не забанкован.`;
  }
  await post("/api/factory/reject", { recipe_id: recipeId, url, hook, reason: reason || "не то", niche, article });
  return `✕ Учтено${reason ? `: «${reason}»` : ""} — пойдёт в обучение (анти-паттерн ниши).`;
}

// классифицировать голос/текст-отзыв оператора → {verdict, reason}
async function parseIntent(text: string): Promise<{ verdict: string; reason: string }> {
  const client = await createClaudeClient();
  if (!client) {
    // фолбэк без LLM — простые ключи (без \b: он ASCII-only, на кириллице не якорится)
    const ok = /(^|\W)(ок|окей|беру|годится|хорош|супер|оставля|подход)/i.test(text);
    const no = /(^|\W)(не |нет|плох|брак|передел|слаб|говн|туфт|убери)/i.test(text);
    return { verdict: ok && !no ? "approve" : no ? "reject" : "unclear", reason: no ? text.slice(0, 120) : "" };
  }
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5", max_tokens: 200,
      system: "Классифицируй отзыв оператора о сгенерированном ролике. Верни СТРОГО JSON {\"verdict\":\"approve|reject|unclear\",\"reason\":\"кратко что не так, если reject\"}. approve — берёт/одобряет; reject — забраковал; unclear — непонятно. Только JSON.",
      messages: [{ role: "user", content: `Отзыв: «${text.slice(0, 500)}»` }],
    });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const j = extractJson(txt);
    if (j) return { verdict: ["approve", "reject", "unclear"].includes(j.verdict) ? j.verdict : "unclear", reason: String(j.reason || "").slice(0, 120) };
  } catch { /* фолбэк ниже */ }
  return { verdict: "unclear", reason: "" };
}

const recipeFromCaption = (cap?: string): number | null => { const m = (cap || "").match(/#r(\d+)/); return m ? Number(m[1]) : null; };

async function recordVoiceSelection(db: any, selection: ReturnType<typeof parseVoiceTelegramSelection>, source: "text" | "button") {
  if (!db || !selection.selectedIndexes.length) return;
  try {
    await db.from("cf_signals").insert({
      event: "voice_review_selected",
      reason_chip: selection.selectedCandidateIds.join(", ").slice(0, 80) || selection.selectedIndexes.join(", "),
      params: {
        source: `telegram_voice_review_${source}`,
        batch_id: selection.batchId,
        selected_indexes: selection.selectedIndexes,
        selected_candidate_ids: selection.selectedCandidateIds,
      },
    });
  } catch { /* best-effort voice learning signal */ }
}

export async function POST(req: NextRequest) {
  try {
  // верификация FAIL-CLOSED: без токена ИЛИ при неверном секрете — молча игнорим (не пускаем дальше).
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!tgReady() || secret !== tgWebhookSecret()) return NextResponse.json({ ok: true });
  const origin = req.nextUrl.origin;
  const db = getSupabaseAdmin();
  const update = await req.json().catch(() => ({}));
  const owner = tgOwnerChat();

  try {
    // ── кнопки ✓Беру/✕Не то ──
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message?.chat?.id || "");
      if (!owner || chatId !== owner) { await tgAnswerCallback(cq.id, owner ? "не твой чат" : "сначала задай FACTORY_TG_CHAT_ID в Vercel"); return NextResponse.json({ ok: true }); }
      const [act, idStr] = String(cq.data || "").split(":");
      if (act === "vwin") {
        const [, batchId, indexRaw, candidateId] = String(cq.data || "").split(":");
        const selection = { batchId: batchId || null, selectedIndexes: [Number(indexRaw)].filter(Boolean), selectedCandidateIds: candidateId ? [candidateId] : [] };
        await recordVoiceSelection(db, selection, "button");
        await tgAnswerCallback(cq.id, `Принял №${indexRaw} как лучший голос.`);
        await tgSendMessage(`Запомнил голос №${indexRaw}: ${candidateId || "без id"}.\nСледующий batch соберём вокруг него.`, chatId);
        return NextResponse.json({ ok: true });
      }
      const recipeId = Number(idStr);
      let msg = "не понял кнопку";
      if (recipeId && db) msg = await applyVerdict(origin, db, recipeId, act === "win" ? "approve" : "reject", "");
      await tgAnswerCallback(cq.id, msg);
      return NextResponse.json({ ok: true });
    }

    const m = update.message;
    if (m) {
      const chatId = String(m.chat?.id || "");
      // /start — отдаём chat_id, чтобы владелец положил FACTORY_TG_CHAT_ID
      if (typeof m.text === "string" && m.text.trim().startsWith("/start")) {
        await tgSendMessage(`Заводской бот на связи. Твой chat_id: ${chatId}\nПоложи его в Vercel как FACTORY_TG_CHAT_ID.`, chatId);
        return NextResponse.json({ ok: true });
      }
      if (!owner || chatId !== owner) return NextResponse.json({ ok: true }); // голос/текст-вердикты — только владельцу (owner задан)

      // голос-ревью: скачать → whisper → классифицировать → применить к рецепту из подписи-ответа
      const voice = m.voice || m.audio;
      if (voice?.file_id) {
        const recipeId = recipeFromCaption(m.reply_to_message?.caption);
        const fileUrl = await tgFileUrl(voice.file_id);
        const tr = fileUrl ? await transcribeFal(fileUrl) : { text: null, error: "нет файла" };
        if (!tr.text) { await tgSendMessage(`Не разобрал голос (${tr.error || "пусто"}). Повтори или нажми кнопку.`, chatId); return NextResponse.json({ ok: true }); }
        const { verdict, reason } = await parseIntent(tr.text);
        if (!recipeId) { await tgSendMessage(`Услышал: «${tr.text.slice(0, 120)}». Но не понял, к какому ролику — ответь голосом НА сообщение с видео.`, chatId); return NextResponse.json({ ok: true }); }
        if (verdict === "unclear" || !db) { await tgSendMessage(`Услышал: «${tr.text.slice(0, 120)}» — не понял вердикт. Скажи яснее «беру» или «не то, потому что…».`, chatId); return NextResponse.json({ ok: true }); }
        const res = await applyVerdict(origin, db, recipeId, verdict, reason);
        await tgSendMessage(`🎙 «${tr.text.slice(0, 100)}»\n${res}`, chatId);
        return NextResponse.json({ ok: true });
      }

      // текст-отзыв как ответ на ролик
      if (typeof m.text === "string" && /(^|[\s,;])#?v?\d{1,2}(?=$|[\s,;])/i.test(m.text)) {
        const context = `${m.reply_to_message?.text || ""}\n${m.reply_to_message?.caption || ""}`;
        const selection = parseVoiceTelegramSelection(m.text, context);
        if (selection.selectedIndexes.length) {
          await recordVoiceSelection(db, selection, "text");
          const picked = selection.selectedCandidateIds.length ? `: ${selection.selectedCandidateIds.join(", ")}` : "";
          await tgSendMessage(`Принял голос${selection.selectedIndexes.length > 1 ? "а" : ""} №${selection.selectedIndexes.join(", ")}${picked}.\nСледующий batch соберём вокруг выбранного.`, chatId);
          return NextResponse.json({ ok: true });
        }
      }

      // текст-отзыв как ответ на ролик
      if (typeof m.text === "string" && m.reply_to_message?.caption) {
        const recipeId = recipeFromCaption(m.reply_to_message.caption);
        if (recipeId && db) { const { verdict, reason } = await parseIntent(m.text); if (verdict !== "unclear") { const res = await applyVerdict(origin, db, recipeId, verdict, reason); await tgSendMessage(res, chatId); } }
        return NextResponse.json({ ok: true });
      }
    }
  } catch { /* вебхук всегда 200, иначе Telegram ретраит */ }
  return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      warning: "telegram POST crash: " + String((e as Error)?.message || e).slice(0, 160),
    });
  }
}
