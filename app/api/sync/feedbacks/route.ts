import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetProductScope, getActiveWbCabinets, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { fetchWbFeedbacksPage, WbFeedbacksCursorError, WbFeedbacksScopeError, type WbFeedbackRaw } from "@/lib/wb/feedbacksApi";
import { allowsProduct } from "@/lib/wb/productScope";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

export const maxDuration = 300;

const TAKE = 5_000;
const MAX_PAGES_PER_RUN = 30;
const ANSWERED_WINDOW_DAYS = 35;

interface FeedbackCursorState extends Record<string, unknown> {
  unansweredSkip: number;
  answeredSkip: number;
  unansweredDone: boolean;
  answeredDone: boolean;
  nextKind: "unanswered" | "answered";
  rowsInCycle: number;
  retentionDays: number;
  coveragePct: number;
  lastSyncedAt?: string;
  completedAt?: string;
}

function feedbackRow(cabinetId: string, feedback: WbFeedbackRaw, isAnswered: boolean, stamp: string) {
  const product = feedback.productDetails!;
  return {
    id: feedback.id,
    cabinet_id: cabinetId,
    nm_id: product.nmId,
    imt_id: product.imtId ?? null,
    article: product.supplierArticle ?? "",
    brand_name: product.brandName ?? null,
    product_name: product.productName ?? null,
    rating: feedback.productValuation,
    review_text: feedback.text ?? null,
    pros: feedback.pros ?? null,
    cons: feedback.cons ?? null,
    photos: (feedback.photoLinks ?? []).map((photo) => ({ mini: photo.miniSize, full: photo.fullSize })),
    has_video: Boolean(feedback.video),
    is_answered: isAnswered,
    answer_text: feedback.answer?.text ?? null,
    created_at_wb: feedback.createdDate ?? null,
    synced_at: stamp,
  };
}

/**
 * Храним все актуальные неотвеченные отзывы и 35 дней отвеченных. Окончательного
 * лимита строк нет: каждый час продолжаем с сохранённого skip, а завершённый
 * проход начинаем заново, чтобы обновить ответы и новые отзывы.
 */
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const deadline = Date.now() + 280_000;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const allCabs = await getActiveWbCabinets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const cabs = onlyCabinet ? allCabs.filter((cabinet) => cabinet.id === onlyCabinet) : allCabs;
  if (!cabs.length) return NextResponse.json({ ok: true, rows: 0, cabinets: 0, progress: [] });
  const hourIndex = Math.floor(Date.now() / 3_600_000);
  const offset = onlyCabinet || cabs.length < 2 ? 0 : hourIndex % cabs.length;
  const orderedCabs = [...cabs.slice(offset), ...cabs.slice(0, offset)];

  const cutoff = Date.now() - ANSWERED_WINDOW_DAYS * 86_400_000;
  let total = 0;
  const errors: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  for (const cabinet of orderedCabs) {
    if (Date.now() > deadline) {
      errors.push(`${cabinet.name}: продолжение перенесено на следующий запуск`);
      continue;
    }
    const previous = await readWbSyncState<FeedbackCursorState>(db, cabinet.id, "feedbacks");
    if (!(await claimWbSyncJob(db, cabinet.id, "feedbacks", 6 * 60))) {
      progress.push({ cabinet: cabinet.name, status: "running", skipped: true });
      continue;
    }
    const token = resolveWbToken(cabinet, "feedbacks");
    const productScope = cabinetProductScope(cabinet);
    let unansweredSkip = Number(previous?.state.unansweredSkip ?? 0);
    let answeredSkip = Number(previous?.state.answeredSkip ?? 0);
    let unansweredDone = Boolean(previous?.state.unansweredDone);
    let answeredDone = Boolean(previous?.state.answeredDone);
    let nextKind: "unanswered" | "answered" = previous?.state.nextKind === "answered" ? "answered" : "unanswered";
    let rowsInCycle = Number(previous?.state.rowsInCycle ?? 0);
    let pages = 0;
    let cursorResets = 0;

    try {
      while (pages < MAX_PAGES_PER_RUN && Date.now() < deadline) {
        if (unansweredDone && answeredDone) break;
        if ((nextKind === "unanswered" && unansweredDone) || (nextKind === "answered" && answeredDone)) {
          nextKind = nextKind === "unanswered" ? "answered" : "unanswered";
          continue;
        }

        const isAnswered = nextKind === "answered";
        const skip = isAnswered ? answeredSkip : unansweredSkip;
        let list: WbFeedbackRaw[];
        try {
          list = await fetchWbFeedbacksPage(token, isAnswered, skip, TAKE);
        } catch (error) {
          if (error instanceof WbFeedbacksCursorError && skip > 0 && cursorResets < 2) {
            cursorResets++;
            if (isAnswered) {
              answeredSkip = 0;
              answeredDone = false;
            } else {
              unansweredSkip = 0;
              unansweredDone = false;
            }
            nextKind = isAnswered ? "answered" : "unanswered";
            continue;
          }
          throw error;
        }
        let hitCutoff = false;
        const stamp = new Date().toISOString();
        const rows = list
          .filter((feedback) => {
            const product = feedback.productDetails;
            if (!feedback.id || !product?.nmId) return false;
            if (!allowsProduct(productScope, product.nmId, product.brandName)) return false;
            if (isAnswered && feedback.createdDate && new Date(feedback.createdDate).getTime() < cutoff) {
              hitCutoff = true;
              return false;
            }
            return true;
          })
          .map((feedback) => feedbackRow(cabinet.id, feedback, isAnswered, stamp));
        const upsertError = rows.length ? await chunkedUpsert("wb_feedbacks", rows, "id") : null;
        if (upsertError) throw new Error(upsertError);
        total += rows.length;
        rowsInCycle += rows.length;
        pages++;

        const streamDone = list.length < TAKE || (isAnswered && hitCutoff);
        if (isAnswered) {
          answeredDone = streamDone;
          answeredSkip = streamDone ? 0 : skip + TAKE;
        } else {
          unansweredDone = streamDone;
          unansweredSkip = streamDone ? 0 : skip + TAKE;
        }
        nextKind = isAnswered ? "unanswered" : "answered";
      }

      const completed = unansweredDone && answeredDone;
      const syncedAt = new Date().toISOString();
      const coveragePct = completed ? 100 : unansweredDone || answeredDone ? 50 : 0;
      const stateError = await writeWbSyncState(db, cabinet.id, "feedbacks", {
        cursor: JSON.stringify({ unansweredSkip, answeredSkip, nextKind }),
        status: completed ? "caught_up" : "running",
        attempts: 0,
        lastError: null,
        state: {
          unansweredSkip: completed ? 0 : unansweredSkip,
          answeredSkip: completed ? 0 : answeredSkip,
          unansweredDone: completed ? false : unansweredDone,
          answeredDone: completed ? false : answeredDone,
          nextKind,
          rowsInCycle: completed ? 0 : rowsInCycle,
          retentionDays: ANSWERED_WINDOW_DAYS,
          coveragePct,
          lastSyncedAt: syncedAt,
          ...(completed ? { completedAt: syncedAt } : {}),
        },
      });
      if (stateError) throw new Error(`состояние feedbacks: ${stateError}`);
      progress.push({ cabinet: cabinet.name, status: completed ? "caught_up" : "running", pages, rows: rowsInCycle, coveragePct, unansweredSkip, answeredSkip, cursorResets });
    } catch (error) {
      const message = error instanceof WbFeedbacksScopeError
        ? "Нет категории токена «Вопросы и Отзывы»"
        : error instanceof Error ? error.message : "Unknown error";
      errors.push(`${cabinet.name}: ${message}`);
      await writeWbSyncState(db, cabinet.id, "feedbacks", {
        cursor: JSON.stringify({ unansweredSkip, answeredSkip, nextKind }),
        status: "error",
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: message,
        state: {
          unansweredSkip,
          answeredSkip,
          unansweredDone,
          answeredDone,
          nextKind,
          rowsInCycle,
          retentionDays: ANSWERED_WINDOW_DAYS,
          coveragePct: unansweredDone || answeredDone ? 50 : 0,
          lastSyncedAt: new Date().toISOString(),
        },
      });
    }
  }

  const ok = errors.length === 0;
  await writeSyncLog("feedbacks", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
  return NextResponse.json({ ok, rows: total, cabinets: cabs.length, retentionDays: ANSWERED_WINDOW_DAYS, progress, errors }, { status: ok ? 200 : 502 });
}
