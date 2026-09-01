import { NextRequest, NextResponse } from "next/server";

import { decideBid, orderRulesBySafety, type BidRule, type BidRuleDecision, type BidRuleFact } from "@/lib/adverts/bidRules";
import { resolveAdvertCabinetAccess } from "@/lib/adverts/cabinetGuard";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import { setAdvertBids, type AdvertPlacement } from "@/lib/wb/advertApi";
import { getActiveWbCabinets, resolveWbToken, type WbCabinet } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PATCH /api/advert/v1/bids — 5 запросов в секунду на аккаунт продавца. Держимся
// вдвое ниже потолка: прогон не срочный, а 429 посреди пачки оставляет часть
// правил применённой, а часть нет.
const APPLY_PAUSE_MS = 400;

interface RuleRow {
  id: string;
  cabinet_id: string;
  advert_id: number;
  nm_id: number | null;
  placement: string;
  goal: string;
  target: number;
  window_days: number;
  step_percent: number;
  min_bid: number;
  max_bid: number;
  min_orders: number;
  enabled: boolean;
}

interface NmFactRow {
  advert_id: number;
  nm_id: number;
  date: string;
  spent: number | null;
  orders: number | null;
  orders_sum: number | null;
}

interface AdvertNmSetting {
  nm_id?: number;
  bids_kopecks?: { search?: number; recommendations?: number };
}

function toRule(row: RuleRow): BidRule {
  return {
    id: row.id,
    advertId: Number(row.advert_id),
    nmId: row.nm_id == null ? null : Number(row.nm_id),
    goal: row.goal === "cpo" ? "cpo" : "drr",
    target: Number(row.target),
    windowDays: Number(row.window_days),
    stepPercent: Number(row.step_percent),
    minBid: Number(row.min_bid),
    maxBid: Number(row.max_bid),
    minOrders: Number(row.min_orders),
    enabled: row.enabled,
  };
}

interface Gate {
  /** Разрешён ли боевой прогон (запись ставок в WB). */
  live: boolean;
  /** Ограничение по кабинету: null — все (только крон). */
  cabinetId: string | null;
}

/**
 * Кто имеет право запускать правила.
 *
 * Раньше здесь стоял общий `checkCronAuth`, и это была дыра: его allowlist
 * (director, finance) написан под СИНКИ, которые только читают у маркетплейса и
 * пишут в нашу же базу. Этот роут другой — без `?dry=1` он вызывает setAdvertBids
 * и меняет ставки в живом кабинете WB, а без параметра cabinet проходит по ВСЕМ
 * кабинетам сразу. Обоснование «необратимого действия здесь нет», записанное в
 * комментарии к allowlist синков, к смене ставок за деньги не относится.
 *
 * Теперь право разведено по последствиям:
 *   Bearer CRON_SECRET — боевой прогон по всем кабинетам. Это машина по расписанию.
 *   Живая сессия — только через рекламный гейт, с ЯВНО указанным кабинетом и
 *     правом canOperate в нём. Человек отвечает за один кабинет, а не за все.
 *   Всё остальное — сухой прогон, если сессия вообще есть.
 *
 * Отсутствие CRON_SECRET больше не открывает роут настежь: для читающих синков
 * это было приемлемым упрощением в разработке, для записи денег — нет.
 */
async function resolveGate(request: NextRequest): Promise<{ gate: Gate; response?: never } | { gate?: never; response: NextResponse }> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) {
    const only = request.nextUrl.searchParams.get("cabinet");
    return { gate: { live: true, cabinetId: only || null } };
  }

  const cabinetId = request.nextUrl.searchParams.get("cabinet");
  if (!cabinetId) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return { response: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) };
    return {
      response: NextResponse.json(
        { error: "Прогон по всем кабинетам доступен только по расписанию. Укажите кабинет параметром cabinet." },
        { status: 400 },
      ),
    };
  }

  const access = await resolveAdvertCabinetAccess(cabinetId);
  if (access.response) return { response: access.response };
  return { gate: { live: true, cabinetId: access.access.cabinet.id } };
}

/**
 * Текущие ставки кабинета одним запросом.
 *
 * Спрашивать WB отдельно про каждую кампанию было бы и дольше, и дороже по
 * лимиту, а главное — бессмысленно: v2/adverts отдаёт сразу все кампании со
 * ставками по каждому артикулу. Берём факт у WB, а не из своей таблицы: ставку
 * могли поменять руками в кабинете между синками, и правило, считающее от
 * устаревшего числа, шагнёт не оттуда.
 */
async function currentBids(token: string, host: string) {
  const map = new Map<string, number>();
  try {
    const res = await fetch(`${host}/api/advert/v2/adverts`, { headers: { Authorization: token }, cache: "no-store" });
    if (!res.ok) return { map, error: `WB ${res.status}` };
    const json = (await res.json()) as { adverts?: Array<{ id?: number; nm_settings?: AdvertNmSetting[] }> };
    for (const advert of json.adverts ?? []) {
      if (!advert.id) continue;
      for (const setting of advert.nm_settings ?? []) {
        if (!setting.nm_id) continue;
        const search = setting.bids_kopecks?.search;
        const shelf = setting.bids_kopecks?.recommendations;
        if (search) map.set(`${advert.id}|${setting.nm_id}|search`, search / 100);
        if (shelf) map.set(`${advert.id}|${setting.nm_id}|recommendations`, shelf / 100);
        // У единой ставки места не разделены. Берём поисковую как значение
        // combined — это то же число, которым WB оперирует для такой кампании.
        if (search) map.set(`${advert.id}|${setting.nm_id}|combined`, search / 100);
      }
    }
    return { map, error: null as string | null };
  } catch (err) {
    return { map, error: err instanceof Error ? err.message : "error" };
  }
}

/**
 * Прогон автоправил.
 *
 * Окно факта заканчивается ВЧЕРА, а не сегодня. Сегодняшний день неполон
 * несимметрично: расход в нём уже есть, а заказы по нему ещё доедут — WB отдаёт
 * продажи с задержкой. Правило, считающее ДРР по такому дню, каждое утро видит
 * завышенную цифру и послушно снижает ставку на ровном месте.
 *
 * `?dry=1` считает и показывает решения, ничего не отправляя в WB. Это не
 * отладочный режим, а нормальный способ работы с автоматикой: прежде чем
 * доверить правилу деньги, полезно неделю посмотреть, что оно собиралось делать.
 */
export async function GET(request: NextRequest) {
  const gated = await resolveGate(request);
  if (gated.response) return gated.response;
  const gate = gated.gate;

  const dryRun = request.nextUrl.searchParams.get("dry") === "1" || !gate.live;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  let query = db
    .from("advert_rules")
    .select("id, cabinet_id, advert_id, nm_id, placement, goal, target, window_days, step_percent, min_bid, max_bid, min_orders, enabled")
    .eq("enabled", true);
  if (gate.cabinetId) query = query.eq("cabinet_id", gate.cabinetId);

  const { data, error } = await query;
  if (error) {
    const notDeployed = error.code === "42P01";
    return NextResponse.json(
      { error: notDeployed ? "Не применена миграция 202609010003_advert_rules.sql" : error.message },
      { status: 500 },
    );
  }
  const rows = (data ?? []) as RuleRow[];
  if (!rows.length) return NextResponse.json({ ok: true, dryRun, rules: 0, applied: 0, results: [] });

  const cabinets = new Map<string, WbCabinet>();
  for (const cabinet of await getActiveWbCabinets()) cabinets.set(cabinet.id, cabinet);

  const today = moscowToday();
  const results: Array<Record<string, unknown>> = [];
  const runLog: Array<Record<string, unknown>> = [];

  const byCabinet = new Map<string, RuleRow[]>();
  for (const row of rows) {
    const list = byCabinet.get(row.cabinet_id) ?? [];
    list.push(row);
    byCabinet.set(row.cabinet_id, list);
  }

  for (const [cabinetId, cabinetRules] of byCabinet) {
    const cabinet = cabinets.get(cabinetId);
    if (!cabinet) {
      for (const row of cabinetRules) {
        results.push({ ruleId: row.id, decision: "error", reason: "Кабинет отключён или удалён" });
        runLog.push({ rule_id: row.id, advert_id: row.advert_id, nm_id: row.nm_id, decision: "error", reason: "Кабинет отключён или удалён" });
      }
      continue;
    }
    const token = resolveWbToken(cabinet, "advert");
    const host = (await import("@/lib/wb/advertApi")).advertHost(token);
    const bids = await currentBids(token, host);

    const maxWindow = Math.max(...cabinetRules.map((row) => Number(row.window_days) || 3));
    const from = shiftIsoDay(today, -maxWindow);
    const to = shiftIsoDay(today, -1);
    const advertIds = [...new Set(cabinetRules.map((row) => Number(row.advert_id)))];

    const [nmFacts, campaignFacts] = await Promise.all([
      db
        .from("wb_advert_nm_campaign_daily")
        .select("advert_id, nm_id, date, spent, orders, orders_sum")
        .eq("cabinet_id", cabinetId)
        .in("advert_id", advertIds)
        .gte("date", from)
        .lte("date", to),
      // Расход кампании целиком — контрольная величина. Нужна не для счёта, а
      // чтобы отличить «рекламы не было» от «WB не разнёс расход по артикулам».
      db
        .from("wb_advert_stats")
        .select("advert_id, date, sum_spent")
        .in("advert_id", advertIds)
        .gte("date", from)
        .lte("date", to),
    ]);

    const facts = (nmFacts.data ?? []) as NmFactRow[];
    const campaignSpend = new Map<number, number>();
    for (const row of (campaignFacts.data ?? []) as Array<{ advert_id: number; date: string; sum_spent: number | null }>) {
      if (row.date < from || row.date > to) continue;
      const id = Number(row.advert_id);
      campaignSpend.set(id, (campaignSpend.get(id) ?? 0) + Number(row.sum_spent ?? 0));
    }

    const decisions = cabinetRules.map((row) => {
      const rule = toRule(row);
      const ruleFrom = shiftIsoDay(today, -rule.windowDays);
      const fact: BidRuleFact = { spent: 0, orders: 0, ordersSum: 0 };
      for (const item of facts) {
        if (Number(item.advert_id) !== rule.advertId) continue;
        if (rule.nmId != null && Number(item.nm_id) !== rule.nmId) continue;
        if (item.date < ruleFrom || item.date > to) continue;
        fact.spent += Number(item.spent ?? 0);
        fact.orders += Number(item.orders ?? 0);
        fact.ordersSum += Number(item.orders_sum ?? 0);
      }

      const nmId = rule.nmId ?? facts.find((item) => Number(item.advert_id) === rule.advertId && Number(item.spent ?? 0) > 0)?.nm_id ?? null;
      const placement = row.placement as AdvertPlacement;
      const currentBid = nmId == null ? 0 : bids.map.get(`${rule.advertId}|${nmId}|${placement}`) ?? 0;

      // Расход по артикулам нулевой, а по кампании — нет. Это не «рекламы не
      // было»: WB просто не разложил расход на артикулы, и такое бывает
      // регулярно (для отчётов у нас на это есть отдельная раскладка остатка).
      // Правило в этом случае обязано молчать, а не читать ноль как факт:
      // ошибка тут всегда в одну сторону — заниженный ДРР и ложное «поднять».
      const wholeCampaignSpend = campaignSpend.get(rule.advertId) ?? 0;
      const unallocated = fact.spent <= 0 && wholeCampaignSpend > 0;

      const decision: BidRuleDecision = unallocated
        ? {
            action: "hold",
            reason: `WB не разнёс расход кампании по артикулам за окно (по кампании ${Math.round(wholeCampaignSpend)}, по артикулам 0) — считать ДРР не из чего.`,
            currentBid,
            newBid: null,
          }
        : nmId == null
          ? { action: "hold", reason: "В окне нет артикула с расходом — менять нечего.", currentBid: 0, newBid: null }
          : decideBid(rule, fact, currentBid);
      return { row, rule, fact, nmId, placement, decision };
    });

    for (const item of orderRulesBySafety(decisions)) {
      const base = {
        ruleId: item.rule.id,
        advertId: item.rule.advertId,
        nmId: item.nmId,
        placement: item.placement,
        fact: item.fact,
        decision: item.decision.action,
        reason: item.decision.reason,
        oldBid: item.decision.currentBid || null,
        newBid: item.decision.newBid,
      };

      if (item.decision.action === "hold" || item.decision.newBid == null || item.nmId == null) {
        results.push(base);
        runLog.push({
          rule_id: item.rule.id, advert_id: item.rule.advertId, nm_id: item.nmId,
          decision: "hold", old_bid: item.decision.currentBid || null, new_bid: null,
          reason: item.decision.reason, fact: item.fact,
        });
        continue;
      }

      if (dryRun) {
        results.push({ ...base, applied: false, dryRun: true });
        continue;
      }

      const applied = await setAdvertBids(token, [{
        advertId: item.rule.advertId,
        nmBids: [{ nmId: item.nmId, bidKopecks: Math.round(item.decision.newBid * 100), placement: item.placement }],
      }]);
      await new Promise((resolve) => setTimeout(resolve, APPLY_PAUSE_MS));

      results.push({ ...base, applied: applied.ok, error: applied.ok ? null : applied.message });
      runLog.push({
        rule_id: item.rule.id, advert_id: item.rule.advertId, nm_id: item.nmId,
        decision: applied.ok ? item.decision.action : "error",
        old_bid: item.decision.currentBid, new_bid: applied.ok ? item.decision.newBid : null,
        reason: applied.ok ? item.decision.reason : applied.message,
        fact: item.fact,
      });

      // Действие автомата попадает в тот же журнал, что и действие человека.
      // Отдельная история для правил означала бы два места, где надо искать
      // ответ на вопрос «кто трогал эту ставку».
      await db.from("advert_bid_changes").insert({
        advert_id: item.rule.advertId,
        cabinet_id: cabinetId,
        user_email: "автоправило",
        action: "rule_apply",
        old_bid: item.decision.currentBid,
        new_bid: item.decision.newBid,
        old_value: item.decision.currentBid,
        new_value: item.decision.newBid,
        status: applied.ok ? "ok" : "error",
        detail: `${item.decision.reason}`.slice(0, 500),
        wb_result: applied.ok ? applied.data : applied.raw ?? applied.message,
      });
    }

    if (bids.error) results.push({ cabinetId, warning: `Ставки WB прочитаны не полностью: ${bids.error}` });
    if (nmFacts.error) results.push({ cabinetId, warning: `Факт по артикулам прочитан не полностью: ${nmFacts.error.message}` });
    if (campaignFacts.error) results.push({ cabinetId, warning: `Расход кампаний прочитан не полностью: ${campaignFacts.error.message}` });
  }

  if (!dryRun && runLog.length) {
    await db.from("advert_rule_runs").insert(runLog);
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    rules: rows.length,
    applied: results.filter((item) => item.applied === true).length,
    results,
  });
}
