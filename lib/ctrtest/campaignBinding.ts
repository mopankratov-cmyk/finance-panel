import type { SupabaseClient } from "@supabase/supabase-js";

import { CTR_MIN_CAMPAIGN_SPEND } from "@/lib/wb/ctrCampaignPick";
import { wbAdvertBlock, type WbAdvertBlockInput, type WbRkBlock } from "@/lib/wb/advertBlocks";
import { ADVERT_STATUS_BY_ACTION, setAdvertLifecycle } from "@/lib/wb/advertApi";

const SEARCH_LOOKBACK_DAYS = 14;
const SEARCH_BLOCKS = new Set<WbRkBlock>(["cpc_search", "cpm_search"]);
const SHELF_BLOCKS = new Set<WbRkBlock>(["cpc_shelf", "cpm_shelf", "cpc_both", "cpm_both"]);

export interface CtrCampaignCandidate {
  advertId: number;
  name: string | null;
  block: WbRkBlock | null;
  spent: number;
}

export type CtrCampaignResolution =
  | { status: "resolved"; advertId: number; candidates: CtrCampaignCandidate[] }
  | { status: "none"; advertId: null; candidates: [] }
  | { status: "ambiguous"; advertId: null; candidates: CtrCampaignCandidate[] };

type AdvertRow = WbAdvertBlockInput & { advert_id: number; name?: string | null };

async function loadAdvertRows(db: SupabaseClient, advertIds: number[]): Promise<AdvertRow[]> {
  if (!advertIds.length) return [];
  const { data } = await db
    .from("wb_adverts")
    .select("advert_id, name, bid_type, payment_type, placement_search, placement_shelf, bid_cpm_rub, bid_search_rub, bid_shelf_rub, block_override")
    .in("advert_id", advertIds);
  return (data ?? []) as AdvertRow[];
}

/**
 * Поисковая кампания теста — по доказанной активности на артикуле, не по
 * технической пригодности. Источник — тот же порог `CTR_MIN_CAMPAIGN_SPEND`,
 * что уже одобрен владельцем 11.09.2026 для выбора кампании без смешивания
 * CPC/CPM (lib/wb/ctrCampaignPick.ts) — здесь та же логика «кампания реально
 * работала», только выбор делается один раз при старте теста, а не по дням.
 */
export async function resolveCtrSearchCampaign(
  db: SupabaseClient,
  cabinetId: string,
  nmId: number,
): Promise<CtrCampaignResolution> {
  const since = new Date(Date.now() - SEARCH_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("wb_advert_nm_campaign_daily")
    .select("advert_id, spent")
    .eq("cabinet_id", cabinetId)
    .eq("nm_id", nmId)
    .gte("date", since);
  if (error) return { status: "none", advertId: null, candidates: [] };

  const spendByAdvert = new Map<number, number>();
  for (const row of (data ?? []) as { advert_id: number; spent: number | null }[]) {
    const id = Number(row.advert_id);
    spendByAdvert.set(id, (spendByAdvert.get(id) ?? 0) + Number(row.spent ?? 0));
  }
  const workingIds = [...spendByAdvert.keys()].filter((id) => (spendByAdvert.get(id) ?? 0) >= CTR_MIN_CAMPAIGN_SPEND);
  if (!workingIds.length) return { status: "none", advertId: null, candidates: [] };

  const adverts = await loadAdvertRows(db, workingIds);
  const candidates: CtrCampaignCandidate[] = adverts
    .map((row) => ({
      advertId: Number(row.advert_id),
      name: row.name ?? null,
      block: wbAdvertBlock(row),
      spent: spendByAdvert.get(Number(row.advert_id)) ?? 0,
    }))
    .filter((candidate) => candidate.block != null && SEARCH_BLOCKS.has(candidate.block))
    .sort((a, b) => b.spent - a.spent);

  if (!candidates.length) return { status: "none", advertId: null, candidates: [] };
  if (candidates.length === 1) return { status: "resolved", advertId: candidates[0].advertId, candidates };
  return { status: "ambiguous", advertId: null, candidates };
}

interface BindableTest {
  id: number;
  cabinetId: string;
  nmId: number;
  testType: string;
  roundNum: number;
  advertId: number | null;
  shelfConflictState: string;
}

/**
 * Резолвит и пишет `ctr_tests.advert_id` (+ первичное `shelf_conflict_state`)
 * РОВНО ОДИН РАЗ — пока у теста ещё не было ни одного раунда. После первого
 * раунда знаменатель метрики менять нельзя: baseline и дельта считались бы
 * по разным кускам показов. Поэтому гвард именно по `roundNum !== 0`, а не
 * по `advertId == null` — тест без найденной кампании (0 или 2+ кандидатов)
 * тоже должен навсегда остаться непривязанным, а не резолвиться заново на
 * каждом действии.
 *
 * Полки проверяются здесь же, а не отдельно, но ТОЛЬКО если человек ещё не
 * принял решение сам через POST .../shelf-conflicts (state всё ещё
 * "unchecked") — иначе повторный вызов на том же первом `start` затёр бы
 * осознанный «declined» обратно в «pending» и заставил решать заново.
 */
export async function ensureCtrTestCampaignBinding(
  db: SupabaseClient,
  test: BindableTest,
  override?: { advertId: number },
): Promise<{ advertId: number | null; shelfConflictState: string }> {
  if (test.testType !== "ctr" || test.roundNum !== 0) return { advertId: test.advertId, shelfConflictState: test.shelfConflictState };

  let advertId: number | null = null;
  if (override) {
    advertId = override.advertId;
  } else {
    const resolution = await resolveCtrSearchCampaign(db, test.cabinetId, test.nmId);
    advertId = resolution.status === "resolved" ? resolution.advertId : null;
  }

  let shelfConflictState = test.shelfConflictState;
  const update: Record<string, unknown> = { advert_id: advertId, updated_at: new Date().toISOString() };
  if (test.shelfConflictState === "unchecked") {
    const shelfConflicts = await findCompetingShelfCampaigns(db, test.cabinetId, test.nmId, advertId);
    shelfConflictState = shelfConflicts.length ? "pending" : "none";
    update.shelf_conflict_state = shelfConflictState;
    update.shelf_conflict_checked_at = new Date().toISOString();
  }
  await db.from("ctr_tests").update(update).eq("id", test.id);
  return { advertId, shelfConflictState };
}

export interface CtrShelfCandidate {
  advertId: number;
  name: string | null;
  block: WbRkBlock;
  statusBefore: number;
}

/**
 * Конкурирующие полочные кампании на этом же артикуле — по пригодности
 * крутиться ПРЯМО СЕЙЧАС (активный статус в `wb_adverts`), а не по истории
 * расхода: риск, от которого защищаемся, — будущее засорение замера, а не
 * прошлое. Уже стоящие на паузе кампании — не конфликт: их не трогали, и
 * именно поэтому автовозврат безопасен (см. `resumeShelfPausesForTest`).
 *
 * Гоча свежести: `wb_adverts`/`nm_ids` обновляются часовым синком
 * (`/api/sync/all?hourly=1`) — полка, включённая в последний час, здесь ещё
 * не будет видна.
 */
export async function findCompetingShelfCampaigns(
  db: SupabaseClient,
  cabinetId: string,
  nmId: number,
  excludeAdvertId: number | null,
): Promise<CtrShelfCandidate[]> {
  const { data } = await db
    .from("wb_adverts")
    .select("advert_id, name, bid_type, payment_type, placement_search, placement_shelf, bid_cpm_rub, bid_search_rub, bid_shelf_rub, block_override, status")
    .eq("cabinet_id", cabinetId)
    .eq("status", ADVERT_STATUS_BY_ACTION.start)
    .contains("nm_ids", [nmId]);

  return ((data ?? []) as (AdvertRow & { status: number })[])
    .filter((row) => Number(row.advert_id) !== excludeAdvertId)
    .map((row) => ({ advertId: Number(row.advert_id), name: row.name ?? null, block: wbAdvertBlock(row), statusBefore: Number(row.status) }))
    .filter((row): row is CtrShelfCandidate => row.block != null && SHELF_BLOCKS.has(row.block));
}

/**
 * Пауза найденных полочных кампаний + запись в `ctr_test_shelf_pauses` — по
 * одной кампании за раз, каждая помечается независимо от успеха соседней.
 * Аудит пишется в `advert_bid_changes` тем же способом, что уже применяют
 * автоправила ставок (`app/api/adverts/rules/run/route.ts`) для действий без
 * живой сессии человека — прямым insert с actorEmail строкой, без
 * заимствования `auditAdvertOperation` (та требует полноценную `Session`,
 * которой у крона `ctr-rotate` и автовозврата попросту нет).
 */
export async function pauseShelfCampaigns(
  db: SupabaseClient,
  input: { testId: number; cabinetId: string; token: string; candidates: CtrShelfCandidate[]; actorEmail: string },
): Promise<{ paused: number[]; failed: { advertId: number; message: string }[] }> {
  const paused: number[] = [];
  const failed: { advertId: number; message: string }[] = [];
  for (const candidate of input.candidates) {
    const result = await setAdvertLifecycle(input.token, candidate.advertId, "pause");
    if (!result.ok) {
      failed.push({ advertId: candidate.advertId, message: result.message });
      continue;
    }
    await db.from("wb_adverts").update({ status: ADVERT_STATUS_BY_ACTION.pause }).eq("advert_id", candidate.advertId).eq("cabinet_id", input.cabinetId);
    await db.from("ctr_test_shelf_pauses").upsert(
      {
        test_id: input.testId,
        cabinet_id: input.cabinetId,
        advert_id: candidate.advertId,
        advert_name: candidate.name,
        block: candidate.block,
        status_before: candidate.statusBefore,
        paused_by: input.actorEmail,
      },
      { onConflict: "test_id,advert_id", ignoreDuplicates: true },
    );
    await db.from("advert_bid_changes").insert({
      advert_id: candidate.advertId,
      cabinet_id: input.cabinetId,
      user_email: input.actorEmail,
      action: "ctr_shelf_pause",
      old_value: candidate.statusBefore,
      new_value: ADVERT_STATUS_BY_ACTION.pause,
      status: "ok",
      detail: `CTR-тест #${input.testId}: пауза конкурирующей полочной кампании на время измерения`,
    });
    paused.push(candidate.advertId);
  }
  return { paused, failed };
}

/**
 * Возвращает только то, что поставил на паузу сам этот тест — строка в
 * `ctr_test_shelf_pauses` появляется исключительно для кампаний, чей статус
 * был активным в момент паузы, поэтому кампания, которую владелец выключил
 * сам ещё до теста, здесь никогда не появится и не будет случайно включена
 * обратно.
 */
export async function resumeShelfPausesForTest(
  db: SupabaseClient,
  input: { testId: number; token: string; actorEmail: string },
): Promise<void> {
  const { data } = await db
    .from("ctr_test_shelf_pauses")
    .select("id, advert_id, cabinet_id")
    .eq("test_id", input.testId)
    .is("resumed_at", null);
  for (const row of (data ?? []) as { id: number; advert_id: number; cabinet_id: string }[]) {
    const result = await setAdvertLifecycle(input.token, row.advert_id, "start");
    if (!result.ok) {
      await db.from("ctr_test_shelf_pauses").update({ resume_error: result.message }).eq("id", row.id);
      continue;
    }
    await db.from("wb_adverts").update({ status: ADVERT_STATUS_BY_ACTION.start }).eq("advert_id", row.advert_id).eq("cabinet_id", row.cabinet_id);
    await db.from("ctr_test_shelf_pauses").update({ resumed_at: new Date().toISOString(), resumed_by: input.actorEmail, resume_error: null }).eq("id", row.id);
    await db.from("advert_bid_changes").insert({
      advert_id: row.advert_id,
      cabinet_id: row.cabinet_id,
      user_email: input.actorEmail,
      action: "ctr_shelf_resume",
      old_value: ADVERT_STATUS_BY_ACTION.pause,
      new_value: ADVERT_STATUS_BY_ACTION.start,
      status: "ok",
      detail: `CTR-тест #${input.testId}: автовозврат полочной кампании после завершения теста`,
    });
  }
}
