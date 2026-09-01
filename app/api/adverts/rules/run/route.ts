import { NextRequest, NextResponse } from "next/server";

import { decideBid, orderRulesBySafety, type BidRule, type BidRuleDecision, type BidRuleFact } from "@/lib/adverts/bidRules";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import { setAdvertBids, type AdvertPlacement } from "@/lib/wb/advertApi";
import { getActiveWbCabinets, resolveWbToken, type WbCabinet } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PATCH /api/advert/v1/bids — 5 запросов в секунду на аккаунт. Держимся вдвое
// ниже потолка: прогон не срочный, а 429 посреди пачки оставляет часть правил
// применённой, а часть нет.
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

interface FactRow {
  advert_id: number;
  nm_id: number;
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

/**
 * Текущие ставки кабинета одним запросом.
 *
 * Спрашивать WB отдельно про каждую кампанию было бы и дольше, и дороже по
 * лимиту, а главное — бессмысленно: v2/adverts отдаёт сразу все кампании со
 * ставками по каждому артикулу. Берём факт у WB, а не из своей таблицы:
 * ставку могли поменять руками в кабинете между синками, и правило, считающее
 * от устаревшего числа, шагнёт не оттуда.
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
 * несимметрично: расход в нём уже есть, а заказы по нему ещё доедут — WB
 * отдаёт продажи с задержкой. Правило, считающее ДРР по такому дню, каждое
 * утро видит завышенную цифру и послушно снижает ставку на ровном месте.
 *
 * `?dry=1` считает и показывает решения, ничего не отправляя в WB. Это не
 * отладочный режим, а нормальный способ работы с автоматикой: прежде чем
 * доверить правилу деньги, полезно неделю посмотреть, что оно собиралось делать.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dry") === "1";
  const onlyCabinet = params.get("cabinet");

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  let query = db
    .from("advert_rules")
    .select("id, cabinet_id, advert_id, nm_id, placement, goal, target, window_days, step_percent, min_bid, max_bid, min_orders, enabled")
    .eq("enabled", true);
  if (onlyCabinet) query = query.eq("cabinet_id", onlyCabinet);

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

  // По кабинетам: один токен, один запрос за ставками, один общий счёт лимита.
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

    // Факт по всем кампаниям кабинета сразу: у правил разные окна, поэтому
    // берём самое длинное и режем по каждому правилу уже в памяти.
    const maxWindow = Math.max(...cabinetRules.map((row) => Number(row.window_days) || 3));
    const from = shiftIsoDay(today, -maxWindow);
    const to = shiftIsoDay(today, -1);
    const { data: factRows } = await db
      .from("wb_advert_nm_campaign_daily")
      .select("advert_id, nm_id, date, spent, orders, orders_sum")
      .eq("cabinet_id", cabinetId)
      .in("advert_id", [...new Set(cabinetRules.map((row) => Number(row.advert_id)))])
      .gte("date", from)
      .lte("date", to);

    const facts = (factRows ?? []) as Array<FactRow & { date: string }>;

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
      // Правило без явного артикула всё равно должна применяться к конкретному:
      // ставка в WB потоварная. Берём тот, по которому в окне был расход, —
      // иначе менять нечего и правило честно об этом скажет.
      const nmId = rule.nmId ?? facts.find((item) => Number(item.advert_id) === rule.advertId && Number(item.spent ?? 0) > 0)?.nm_id ?? null;
      const placement = row.placement as AdvertPlacement;
      const currentBid = nmId == null ? 0 : bids.map.get(`${rule.advertId}|${nmId}|${placement}`) ?? 0;
      const decision: BidRuleDecision = nmId == null
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
