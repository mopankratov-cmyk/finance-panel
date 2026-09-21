import { NextRequest, NextResponse } from "next/server";
import { resumeShelfPausesForTest } from "@/lib/ctrtest/campaignBinding";
import { restoreOriginalCover } from "@/lib/ctrtest/originalCover";
import { isLiveWbCoverUrl } from "@/lib/ctrtest/pinImage";
import { runStepEngineTests } from "@/lib/ctrtest/stepRunner";
import { getCtrMetricSnapshot } from "@/lib/ctrtest/metrics";
import { ctrSnapshotDelta, type CtrMetricSnapshot } from "@/lib/ctrtest/model";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { fetchCardForWrite } from "@/lib/wb/cards";
import { replaceCardCover } from "@/lib/wb/media";

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
 *
 * ВИТРИНА ПРИНАДЛЕЖИТ ВЛАДЕЛЬЦУ, А НЕ ТЕСТУ. Перед первым стартом панель копирует
 * исходную обложку в наше хранилище (lib/ctrtest/originalCover.ts), а когда тест
 * заканчивается — по потолку расхода здесь или руками в action-роуте — кладёт её
 * обратно. Варианты тоже лежат копиями: ссылка на фото карточки WB — адрес
 * позиции, и «возврат» к ней возвращал то, что уже висит.
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
  auto_error: string | null;
  advert_id?: number | null;
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

/**
 * Планировщик Vercel зовёт крон методом GET — и только им.
 *
 * Роут был объявлен одним `POST`, поэтому расписание «каждые пять минут» полтора
 * суток било в 405 Method Not Allowed. След не оставался нигде: до кода дело
 * не доходило, `auto_checked_at` не проставлялся, ошибки не записывались, а на
 * экране автоматика выглядела включённой. Тест владельца простоял 29 часов,
 * набрал 30 352 показа при норме раунда 350 — и не переключился ни разу.
 *
 * Все остальные кроны проекта (`sync/*`, `opiu/monitor`, `repricer/run/cron`,
 * `adverts/rules/run`) экспортируют GET; этот был единственным исключением.
 *
 * POST оставлен: им пользуется ручной прогон и внутренний фан-аут.
 */
export async function GET(request: NextRequest) {
  return rotate(request);
}

export async function POST(request: NextRequest) {
  return rotate(request);
}

async function rotate(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const BASE_COLUMNS = "id, cabinet_id, nm_id, status, round_num, current_variant_id, impressions_per_round, dead_zone_min, photos_original, test_type, auto_error";
  let tests: TestRow[] | null = null;
  {
    const withCampaign = await db.from("ctr_tests").select(`${BASE_COLUMNS}, advert_id`).eq("status", "running").eq("live_swap_enabled", true);
    if (withCampaign.error?.code === "42703") {
      // Колонка Фазы A (миграция 202609150004) ещё не применена владельцем —
      // ротация продолжает работать по смешанной метрике, как раньше.
      const base = await db.from("ctr_tests").select(BASE_COLUMNS).eq("status", "running").eq("live_swap_enabled", true);
      if (base.error) {
        const missing = ["42703", "PGRST204"].includes(base.error.code ?? "");
        return fail(missing ? "Примените миграции 202609050001 и 202609050002" : base.error.message, missing ? 503 : 500);
      }
      tests = ((base.data ?? []) as TestRow[]).map((row) => ({ ...row, advert_id: null }));
    } else if (withCampaign.error) {
      const missing = ["42703", "PGRST204"].includes(withCampaign.error.code ?? "");
      return fail(missing ? "Примените миграции 202609050001 и 202609050002" : withCampaign.error.message, missing ? 503 : 500);
    } else {
      tests = withCampaign.data as TestRow[];
    }
  }

  const now = Date.now();
  const report: { testId: number; outcome: string; detail?: string }[] = [];
  // Тесты, у которых возврат обложки уже пробовали в этом проходе: повторный
  // заход ниже их не трогает, иначе отказ WB бился бы дважды подряд.
  const restoreAttempted = new Set<number>();

  // Тесты нового движка (engine_version = 2) ведёт пошаговый автомат
  // (lib/ctrtest/stepRunner.ts): живая статистика WB, кампания на паузе, пока
  // цифры устаиваются. Ниже остаётся прежний путь — для тестов, созданных до него.
  const engineIds = await runStepEngineTests(db, report, restoreAttempted);

  for (const test of ((tests ?? []) as TestRow[]).filter((row) => !engineIds.has(row.id))) {
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

      const snapshot: CtrMetricSnapshot = await getCtrMetricSnapshot(test.cabinet_id, test.nm_id, test.advert_id ?? null);
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
      // Ссылка на живую обложку карточки — адрес позиции, а не файла: после
      // замены обложки она отдаёт уже подставленный вариант, и «возврат» к этому
      // варианту ничего бы не менял, при этом показы засчитались бы ему.
      // Так у тестов, созданных до закрепления копий (lib/ctrtest/pinImage.ts).
      if (isLiveWbCoverUrl(next.image_url)) {
        note("вариант — живая ссылка на обложку");
        failure = "вариант «Текущее фото» ссылается на живую обложку WB, а не на сохранённую копию (тест создан до исправления) — создайте тест заново";
        continue;
      }

      // ── Запись в карточку WB ──
      const cabinet = await getWbCabinet(test.cabinet_id);
      if (!cabinet) { note("кабинет не найден"); failure = "кабинет не найден"; continue; }
      const contentToken = resolveWbToken(cabinet, "content");
      const card = await fetchCardForWrite(contentToken, test.nm_id);
      if (!card.found) { note("WB не подтвердил карточку"); failure = "WB не подтвердил карточку — запись отменена"; continue; }

      // Исходный набор запоминаем один раз — не для записи, а как след: по нему
      // видно, что было на карточке до теста, если понадобится вернуть руками.
      if (!test.photos_original?.length && card.photos.length) {
        await db.from("ctr_tests").update({ photos_original: card.photos.filter(Boolean) }).eq("id", test.id);
      }

      // Меняем ТОЛЬКО обложку — первую позицию медиа. Раньше здесь
      // переписывался весь набор (`media/save`), и из-за этого автоматика
      // отказывалась работать на карточках с видео: неизвестно было, переживёт
      // ли оно перезапись. Карточек с видео в кабинете больше половины, то есть
      // функция была выключена на большей части ассортимента. Замена по номеру
      // позиции видео и прочие фото не трогает вовсе.
      const write = await replaceCardCover(contentToken, test.nm_id, next.image_url);
      if (!write.ok) { note("WB отказал в записи"); failure = write.error ?? "WB отказал в записи без объяснения"; continue; }
      // Витрина изменена: с этого момента при завершении теста исходную обложку
      // надо вернуть. Метка — до отметки раунда, чтобы сбой ниже её не потерял.
      // Колонка из миграции 202609210001; пока её нет, ошибка не мешает ротации.
      await db.from("ctr_tests").update({ cover_swapped_at: new Date().toISOString() }).eq("id", test.id).is("cover_swapped_at", null);

      // ── И только теперь отметка раунда ──
      const { data: transition, error: transitionError } = await db.rpc("transition_ctr_test", {
        p_input: { testId: test.id, action: "advance", variantId: next.id, snapshot, result: delta, auto: true },
        p_actor: "ctr-rotate",
      });
      if (transitionError) { note("фото сменено, раунд не отмечен"); failure = `фото уже сменено, но раунд не записан: ${transitionError.message}`; continue; }
      const status = (transition as { status?: string } | null)?.status ?? "running";
      note(status === "running" ? "переключено" : status === "paused" ? "потолок расхода — пауза" : "завершён", `вариант ${next.id}`);
      // Автовозврат полок — не на паузе (тест может продолжиться), только
      // когда действительно дошёл до конца.
      if (test.test_type === "ctr" && (status === "done" || status === "cancelled")) {
        const advertToken = resolveWbToken(cabinet, "advert");
        if (advertToken) await resumeShelfPausesForTest(db, { testId: test.id, token: advertToken, actorEmail: "ctr-rotate" });
      }
      // Тест закончился (потолок расхода закрыл его сам) — на витрине нельзя
      // оставлять то, что осталось от последнего раунда. Возврат исходной
      // обложки; не прошёл — повторит проход ниже, пока не получится.
      if (status === "done" || status === "cancelled") {
        restoreAttempted.add(test.id);
        // Свой try: сбой возврата не должен попасть в общий catch — тот пишет
        // auto_error и при повторе ставит тест на паузу, а этот уже закрыт.
        try {
          const restored = await restoreOriginalCover(db, { id: test.id, nm_id: test.nm_id }, contentToken, "ctr-rotate");
          note(`возврат обложки: ${restored.status}`, restored.status === "failed" ? restored.error : undefined);
        } catch (cause) {
          note("возврат обложки: сбой", cause instanceof Error ? cause.message : String(cause));
        }
      }
    } catch (cause) {
      note("сбой", cause instanceof Error ? cause.message : String(cause));
      failure = cause instanceof Error ? cause.message : "неизвестный сбой";
    } finally {
      // Отметка попытки в любом случае: молчащая автоматика неотличима от
      // сломанной, а человек видит на экране только результат.
      //
      // Одинаковый отказ второй раз подряд означает, что дело не в сетевой
      // заминке, а в чём-то, что само не пройдёт: нет следующего варианта,
      // WB не принимает запись, карточка не подтверждается. Раньше в этом
      // случае ротация билась в стену каждые пять минут неделями, а тест на
      // экране всё это время значился идущим — человек считал, что варианты
      // сменяются, пока крутился один. Ставим на паузу с той же причиной:
      // остановленный тест виден в списке, «идущий» с ошибкой — нет.
      const repeated = failure !== null && failure === test.auto_error;
      await db.from("ctr_tests").update({
        auto_checked_at: new Date().toISOString(),
        auto_error: failure,
        ...(repeated ? { status: "paused" } : {}),
      }).eq("id", test.id);
      if (repeated) note("тот же отказ второй раз — тест на паузе");
    }
  }

  // Возврат обложки, что не прошёл с первого раза: WB отказал, сбой сети или тест
  // закрыл человек в момент недоступности. Витрина принадлежит владельцу, поэтому
  // очередь не гаснет, пока `cover_restored_at` пуст. Ошибка запроса — колонок
  // ещё нет (миграция 202609210001 не применена): возвращать нечего.
  const pendingRestore = await db.from("ctr_tests").select("id, cabinet_id, nm_id")
    .in("status", ["done", "cancelled"]).not("cover_swapped_at", "is", null).is("cover_restored_at", null).limit(20);
  for (const pending of pendingRestore.error ? [] : (pendingRestore.data ?? [])) {
    const testId = Number(pending.id);
    if (restoreAttempted.has(testId)) continue;
    try {
      const cabinet = await getWbCabinet(String(pending.cabinet_id));
      const token = cabinet ? resolveWbToken(cabinet, "content") : null;
      if (!token) { report.push({ testId, outcome: "возврат обложки: нет токена контента" }); continue; }
      const restored = await restoreOriginalCover(db, { id: testId, nm_id: Number(pending.nm_id) }, token, "ctr-rotate");
      report.push({ testId, outcome: `возврат обложки: ${restored.status}`, detail: restored.status === "failed" ? restored.error : undefined });
    } catch (cause) {
      report.push({ testId, outcome: "возврат обложки: сбой", detail: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  return NextResponse.json({ ok: true, checked: (tests ?? []).length, report });
}
