import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, groupWbStatisticsTargets } from "@/lib/sync/cabinets";
import { claimWbSyncJob, readWbSyncStateOrThrow, writeWbSyncState } from "@/lib/wb/syncState";
import {
  SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS,
  SEO_LEASE_SECONDS,
  SEO_POSITIONS_JOB,
  loadSeoNmIds,
  runSeoPositionsGroup,
  seoResetWrite,
  seoGroupErrorResults,
  settleWithin,
  summarizeSeoRun,
  type SeoGroupResult,
  type SeoJobDeps,
  type SeoPositionsState,
} from "@/lib/wb/seoPositions";

export const dynamic = "force-dynamic";
// Лимит WB на search-texts — 3 запроса в минуту на продавца, пауза между ними 20,5 с:
// за один прогон выходит не больше одиннадцати-двенадцати запросов на продавца.
export const maxDuration = 300;

// Запросы начинаем не позже чем за 8 с до конца бюджета; сам бюджет — 250 из 300 с.
const RUN_BUDGET_MS = 250_000;
const REQUEST_RESERVE_MS = 8_000;
// Группа, не вернувшаяся к сроку «бюджет + SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS», отдаётся как зависшая: запись
// в sync_log и итог остальных продавцов должны успеть до конца функции (300 с). Таймаут запроса к WB короче
// этой отсечки (seoRequestTimeoutMs), поэтому оборванный запрос успевает записать неудачу до отсечки.

// Замер позиций за ВЧЕРАШНИЙ закрытый день (МСК) по всем SKU каждого WB-кабинета.
// Расписание — несколько прогонов за ночь: один не успевает ни по лимиту WB, ни по
// бюджету функции, а курсор в wb_sync_state продолжает с места остановки. Кабинеты
// ENV-режима (cabinet_id = null) пропускаются: негде хранить курсор.
// ?cabinet=<uuid> — один кабинет; ?force=1 — обойти паузу после 403 (проба после подключения Джема).
// ?cabinet=<uuid>&remeasure=ГГГГ-ММ-ДД — забыть, что день измерен, и измерить заново (после диагноза);
// ?cabinet=<uuid>&reset=1 — то же для всего окна. Без ?cabinet= сброс не принимается: он слишком широкий.
// Сброс паузу после 403 не снимает — только ?force=1.
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const force = request.nextUrl.searchParams.get("force") === "1";
  const remeasure = request.nextUrl.searchParams.get("remeasure");
  const reset = request.nextUrl.searchParams.get("reset") === "1";
  if (remeasure !== null && !/^\d{4}-\d{2}-\d{2}$/.test(remeasure)) {
    return NextResponse.json({ error: "remeasure: ожидается дата ГГГГ-ММ-ДД" }, { status: 400 });
  }
  if ((remeasure !== null || reset) && !onlyCabinet) {
    return NextResponse.json({ error: "remeasure/reset требуют ?cabinet=<uuid>" }, { status: 400 });
  }
  const allTargets = await getWbSyncTargets();
  const targets = allTargets
    .filter((target) => target.cabinetId !== null)
    .filter((target) => !onlyCabinet || target.cabinetId === onlyCabinet);
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных WB-кабинетов с идентификатором (кабинет из env не поддерживается)" }, { status: 500 });
  }

  // Сброс состояния кабинета, чтобы день можно было измерить заново (замер закрыл день, а данных нет).
  let resetInfo: { cabinet: string; day: string | null } | null = null;
  if (onlyCabinet && (remeasure !== null || reset)) {
    let saved: Awaited<ReturnType<typeof readWbSyncStateOrThrow<SeoPositionsState>>>;
    try {
      saved = await readWbSyncStateOrThrow<SeoPositionsState>(db, onlyCabinet, SEO_POSITIONS_JOB);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "не удалось прочитать состояние" }, { status: 500 });
    }
    const leaseFresh = saved?.status === "running" && saved.updatedAt
      && Date.now() - Date.parse(saved.updatedAt) < SEO_LEASE_SECONDS * 1_000;
    if (leaseFresh) {
      return NextResponse.json({ error: "Кабинет сейчас в прогоне: сброс записал бы состояние поверх него" }, { status: 409 });
    }
    if (saved) {
      // Пауза после 403 при сбросе остаётся (seoResetWrite): её снимает только ?force=1.
      const writeError = await writeWbSyncState<SeoPositionsState>(
        db, onlyCabinet, SEO_POSITIONS_JOB, seoResetWrite(saved, reset ? null : remeasure),
      );
      if (writeError) return NextResponse.json({ error: `сброс состояния: ${writeError}` }, { status: 500 });
    }
    resetInfo = { cabinet: onlyCabinet, day: reset ? null : remeasure };
  }

  const deps: SeoJobDeps = {
    // Ошибка базы при чтении состояния бросается: кабинет в этом прогоне пропускается, а не пишется поверх.
    readState: (cabinetId) => readWbSyncStateOrThrow<SeoPositionsState>(db, cabinetId, SEO_POSITIONS_JOB),
    writeState: (cabinetId, values) => writeWbSyncState<SeoPositionsState>(db, cabinetId, SEO_POSITIONS_JOB, values),
    claim: (cabinetId, staleSeconds) => claimWbSyncJob(db, cabinetId, SEO_POSITIONS_JOB, staleSeconds),
    upsertRows: (rows) => chunkedUpsert("wb_seo_positions", rows, "nm_id,keyword,snapshot_date"),
    loadNmIds: (target, activeOnly) => loadSeoNmIds(db, target, activeOnly),
  };

  const deadline = Date.now() + RUN_BUDGET_MS;
  try {
    // Лимит WB — на аккаунт продавца: продавцы идут параллельно, кабинеты одного продавца по очереди.
    const groups = groupWbStatisticsTargets(targets);
    const settled = await Promise.all(groups.map((group): Promise<SeoGroupResult[]> => settleWithin(
      runSeoPositionsGroup(group, deps, { deadline, reserveMs: REQUEST_RESERVE_MS, force })
        // Сбой группы не должен прятать итог остальных и оставлять журнал без записи.
        .catch((error) => seoGroupErrorResults(group, error instanceof Error ? error.message : "неизвестная ошибка")),
      deadline - Date.now() + SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS,
      // Зависшая группа (соединение с WB не отвечает) не должна съесть и журнал: её кабинеты остаются
      // «running» до конца аренды, а следующий прогон продолжит с сохранённого курсора.
      () => seoGroupErrorResults(group, "группа не уложилась в бюджет прогона (запрос к WB завис)"),
    )));
    const results = settled.flat();
    const summary = summarizeSeoRun(results);
    // Для ok журнал чистый, кроме кабинетов, о которых он обязан сказать (без Джема, пропущенные артикулы);
    // при partial/error в нём сводка по всем кабинетам.
    await writeSyncLog(SEO_POSITIONS_JOB, summary.status, summary.rows, summary.logNote, startedAt);
    return NextResponse.json(
      { ok: summary.status !== "error", status: summary.status, rows: summary.rows, requests: summary.requests, cabinets: targets.length, reset: resetInfo, results },
      { status: summary.status === "error" ? 502 : 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog(SEO_POSITIONS_JOB, "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
