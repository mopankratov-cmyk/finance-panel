import { NextRequest, NextResponse } from "next/server";
import { getCtrMetricSnapshot } from "@/lib/ctrtest/metrics";
import { ctrSnapshotDelta, type CtrMetricSnapshot } from "@/lib/ctrtest/model";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { fetchCardForWrite } from "@/lib/wb/cards";
import { saveCardMediaOrder } from "@/lib/wb/media";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Автоматическая смена вариантов CTR-теста.
 *
 * Раньше ротацию вёл человек: ставил фото в кабинете WB и нажимал «дальше»,
 * подтверждая словом CONTENT_IS_SET. Решение владельца 05.09.2026 — включить
 * автоматику; здесь она и живёт.
 *
 * ПОРЯДОК ДЕЙСТВИЙ ВАЖЕН И ОБРАТЕН ПРИВЫЧНОМУ. Сначала пишем фото в карточку,
 * и только потом отмечаем раунд в базе. Наоборот нельзя: запись в WB
 * необратима, и если отметить раунд первым, а запись не пройдёт, панель будет
 * считать, что крутится вариант Б, пока на витрине висит А — и весь замер
 * станет ложью, которую нечем обнаружить. Обратная неудача (фото сменилось,
 * отметка не прошла) видна сразу: следующий проход увидит расхождение и
 * запишет ошибку.
 */

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

interface TestRow {
  id: number;
  cabinet_id: string;
  nm_id: number;
  status: string;
  round_num: number;
  current_variant_id: number | null;
  impressions_per_round: number;
  dead_zone_min: number;
  photos_original: string[] | null;
  test_type: string;
}

interface VariantRow { id: number; image_url: string; position: number | null; rounds_count: number | null }

/** Показы раунда: для видео-тестов метрика другая, но правило одно — норма на вариант. */
function roundVolume(delta: ReturnType<typeof ctrSnapshotDelta>, testType: string): number {
  return testType === "video" ? Number(delta.opens ?? 0) : Number(delta.impressions ?? 0);
}

/**
 * Следующий вариант по кругу.
 *
 * Порядок фиксированный (position), а не «самый отстающий»: тест должен дать
 * каждому одинаковый объём, и выбор по отставанию превращает ротацию в гонку,
 * где один вариант может не выйти вовсе.
 */
function nextVariant(variants: VariantRow[], currentId: number | null): VariantRow | null {
  if (variants.length === 0) return null;
  const index = variants.findIndex((variant) => variant.id === currentId);
  return variants[(index + 1) % variants.length] ?? null;
}

export async function POST(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data: tests, error } = await db
    .from("ctr_tests")
    .select("id, cabinet_id, nm_id, status, round_num, current_variant_id, impressions_per_round, dead_zone_min, photos_original, test_type")
    .eq("status", "running")
    .eq("live_swap_enabled", true);
  if (error) {
    const missing = ["42703", "PGRST204"].includes(error.code ?? "");
    return fail(missing ? "Примените миграции 202609050001 и 202609050002" : error.message, missing ? 503 : 500);
  }

  const now = Date.now();
  const report: { testId: number; outcome: string; detail?: string }[] = [];

  for (const test of (tests ?? []) as TestRow[]) {
    const note = (outcome: string, detail?: string) => { report.push({ testId: test.id, outcome, detail }); };
    let failure: string | null = null;
    try {
      const { data: round } = await db
        .from("ctr_test_rounds")
        .select("id, variant_id, baseline, started_at")
        .eq("test_id", test.id).eq("status", "active").maybeSingle();
      if (!round) { note("нет активного раунда"); failure = "у работающего теста нет активного раунда"; continue; }

      // Мёртвая зона: клики по прежней картинке ещё идут, считать их нового
      // варианта нельзя.
      const sinceSwitch = (now - Date.parse(String(round.started_at))) / 60_000;
      if (sinceSwitch < test.dead_zone_min) { note("мёртвая зона", `${Math.round(sinceSwitch)} мин из ${test.dead_zone_min}`); continue; }

      const snapshot: CtrMetricSnapshot = await getCtrMetricSnapshot(test.cabinet_id, test.nm_id);
      const delta = ctrSnapshotDelta((round.baseline ?? {}) as Partial<CtrMetricSnapshot>, snapshot);
      const volume = roundVolume(delta, test.test_type);
      if (volume < test.impressions_per_round) {
        note("норма не набрана", `${volume} из ${test.impressions_per_round}`);
        continue;
      }

      const { data: variantRows } = await db
        .from("ctr_variants").select("id, image_url, position, rounds_count")
        .eq("test_id", test.id).order("position", { ascending: true });
      const variants = (variantRows ?? []) as VariantRow[];
      const next = nextVariant(variants, round.variant_id as number);
      if (!next?.image_url) { note("нет следующего варианта"); failure = "у теста не нашлось следующего варианта с картинкой"; continue; }

      // ── Запись в карточку WB ──
      const cabinet = await getWbCabinet(test.cabinet_id);
      if (!cabinet) { note("кабинет не найден"); failure = "кабинет не найден"; continue; }
      const card = await fetchCardForWrite(resolveWbToken(cabinet, "content"), test.nm_id);
      if (!card.found) { note("WB не подтвердил карточку"); failure = "WB не подтвердил карточку — запись отменена"; continue; }
      if (card.hasVideo) { note("карточка с видео"); failure = "у карточки есть видео: не проверено, переживает ли оно замену набора медиа"; continue; }

      // Исходный набор запоминаем один раз и дальше строим записи от него:
      // иначе галерея росла бы на вариант с каждым раундом, а исходные кадры
      // вытеснялись бы за её пределы.
      const base = (test.photos_original?.length ? test.photos_original : card.photos).filter(Boolean);
      if (base.length === 0) { note("у карточки нет фото"); failure = "у карточки нет фотографий в пригодном размере"; continue; }
      if (!test.photos_original?.length) {
        await db.from("ctr_tests").update({ photos_original: base }).eq("id", test.id);
      }
      const photosAfter = [next.image_url, ...base.slice(1)];
      const write = await saveCardMediaOrder(resolveWbToken(cabinet, "content"), test.nm_id, photosAfter);
      if (!write.ok) { note("WB отказал в записи"); failure = write.error ?? "WB отказал в записи без объяснения"; continue; }

      // ── И только теперь отметка раунда ──
      const { data: transition, error: transitionError } = await db.rpc("transition_ctr_test", {
        p_input: { testId: test.id, action: "advance", variantId: next.id, snapshot, result: delta, auto: true },
        p_actor: "ctr-rotate",
      });
      if (transitionError) { note("фото сменено, раунд не отмечен"); failure = `фото уже сменено, но раунд не записан: ${transitionError.message}`; continue; }
      const status = (transition as { status?: string } | null)?.status ?? "running";
      note(status === "running" ? "переключено" : status === "paused" ? "потолок расхода — пауза" : "завершён", `вариант ${next.id}`);
    } catch (cause) {
      note("сбой", cause instanceof Error ? cause.message : String(cause));
      failure = cause instanceof Error ? cause.message : "неизвестный сбой";
    } finally {
      // Отметка попытки в любом случае: молчащая автоматика неотличима от
      // сломанной, а человек видит на экране только результат.
      await db.from("ctr_tests").update({ auto_checked_at: new Date().toISOString(), auto_error: failure }).eq("id", test.id);
    }
  }

  return NextResponse.json({ ok: true, checked: (tests ?? []).length, report });
}
