import { NextRequest, NextResponse } from "next/server";

import { auditAdvertOperation, resolveAdvertCabinetAccess, resolveAdvertCabinetContext } from "@/lib/adverts/cabinetGuard";

export const dynamic = "force-dynamic";

const GOALS = ["drr", "cpo"] as const;
const PLACEMENTS = ["search", "recommendations", "combined"] as const;

interface RuleRow {
  id: string;
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
  created_by: string | null;
  updated_at: string;
}

interface RunRow {
  rule_id: string;
  ran_at: string;
  decision: string;
  old_bid: number | null;
  new_bid: number | null;
  reason: string | null;
}

/** Правила кабинета вместе с последним прогоном каждого. */
export async function GET(request: NextRequest) {
  const gate = await resolveAdvertCabinetAccess(new URL(request.url).searchParams.get("cabinet"));
  if (gate.response) return gate.response;
  const { db, cabinet } = gate.access;

  const { data, error } = await db
    .from("advert_rules")
    .select("id, advert_id, nm_id, placement, goal, target, window_days, step_percent, min_bid, max_bid, min_orders, enabled, created_by, updated_at")
    .eq("cabinet_id", cabinet.id)
    .order("updated_at", { ascending: false });

  if (error) {
    const notDeployed = error.code === "42P01";
    return NextResponse.json(
      {
        rules: [],
        error: notDeployed
          ? "Автоправила не развёрнуты: не применена миграция 202609010003_advert_rules.sql"
          : error.message,
      },
      { status: 500 },
    );
  }

  const rules = (data ?? []) as RuleRow[];
  // Последний прогон каждого правила. Правило без прогонов — не поломка, а
  // «ещё ни разу не запускалось», и в интерфейсе это разные состояния.
  const lastRun = new Map<string, RunRow>();
  if (rules.length) {
    const { data: runs } = await db
      .from("advert_rule_runs")
      .select("rule_id, ran_at, decision, old_bid, new_bid, reason")
      .in("rule_id", rules.map((rule) => rule.id))
      .order("ran_at", { ascending: false })
      .limit(rules.length * 5);
    for (const run of (runs ?? []) as RunRow[]) {
      if (!lastRun.has(run.rule_id)) lastRun.set(run.rule_id, run);
    }
  }

  return NextResponse.json({
    rules: rules.map((rule) => ({
      id: rule.id,
      advertId: Number(rule.advert_id),
      nmId: rule.nm_id == null ? null : Number(rule.nm_id),
      placement: rule.placement,
      goal: rule.goal,
      target: Number(rule.target),
      windowDays: rule.window_days,
      stepPercent: Number(rule.step_percent),
      minBid: Number(rule.min_bid),
      maxBid: Number(rule.max_bid),
      minOrders: rule.min_orders,
      enabled: rule.enabled,
      createdBy: rule.created_by,
      updatedAt: rule.updated_at,
      lastRun: lastRun.get(rule.id) ?? null,
    })),
  });
}

/**
 * Создание и правка правила.
 *
 * Правило заводится ВЫКЛЮЧЕННЫМ, если явно не сказано иначе: между «настроил» и
 * «доверил менять ставки без меня» должно быть отдельное осознанное движение.
 * Форма, которая включает автоматику в момент сохранения, превращает опечатку в
 * поле цели в работающий механизм.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const advertId = Number(body.advertId);
  if (!Number.isInteger(advertId) || advertId <= 0) return NextResponse.json({ error: "Нужен advertId" }, { status: 400 });

  // Правило привязано к кампании, поэтому проверяем и владение ею, а не только
  // доступ к кабинету: иначе можно завести правило на чужую кампанию.
  const resolved = await resolveAdvertCabinetContext({ cabinetId: body.cabinetId, advertIds: [advertId] });
  if (resolved.response) return resolved.response;
  const { db, cabinet, session } = resolved.context;

  const goal = String(body.goal);
  const placement = String(body.placement ?? "search");
  const target = Number(body.target);
  const windowDays = Number(body.windowDays ?? 3);
  const stepPercent = Number(body.stepPercent ?? 10);
  const minBid = Number(body.minBid);
  const maxBid = Number(body.maxBid);
  const minOrders = Number(body.minOrders ?? 5);
  const nmId = body.nmId == null || body.nmId === "" ? null : Number(body.nmId);

  if (!GOALS.includes(goal as (typeof GOALS)[number])) return NextResponse.json({ error: "Цель — ДРР или CPO" }, { status: 400 });
  if (!PLACEMENTS.includes(placement as (typeof PLACEMENTS)[number])) return NextResponse.json({ error: "Неизвестное место показа" }, { status: 400 });
  if (!Number.isFinite(target) || target <= 0) return NextResponse.json({ error: "Цель должна быть больше нуля" }, { status: 400 });
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) return NextResponse.json({ error: "Окно — от 1 до 30 дней" }, { status: 400 });
  if (!Number.isFinite(stepPercent) || stepPercent <= 0 || stepPercent > 50) return NextResponse.json({ error: "Шаг — от 0 до 50%" }, { status: 400 });
  if (!Number.isFinite(minBid) || minBid <= 0) return NextResponse.json({ error: "Нужен минимум ставки" }, { status: 400 });
  if (!Number.isFinite(maxBid) || maxBid <= 0) return NextResponse.json({ error: "Нужен максимум ставки" }, { status: 400 });
  if (minBid > maxBid) return NextResponse.json({ error: "Минимум ставки больше максимума" }, { status: 400 });
  if (nmId != null && (!Number.isInteger(nmId) || nmId <= 0)) return NextResponse.json({ error: "Неверный артикул" }, { status: 400 });

  const row = {
    cabinet_id: cabinet.id,
    advert_id: advertId,
    nm_id: nmId,
    placement,
    goal,
    target,
    window_days: windowDays,
    step_percent: stepPercent,
    min_bid: minBid,
    max_bid: maxBid,
    min_orders: minOrders,
    enabled: body.enabled === true,
    created_by: session.email,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = typeof body.id === "string" && body.id
    ? await db.from("advert_rules").update(row).eq("id", body.id).eq("cabinet_id", cabinet.id).select("id").maybeSingle()
    : await db.from("advert_rules").insert(row).select("id").maybeSingle();

  if (error) {
    // Уникальный индекс на (кампания, артикул, место) — не досадное ограничение,
    // а защита: два правила на одну ставку дрались бы каждый прогон.
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "На эту кампанию, артикул и место уже есть правило" : error.message },
      { status: duplicate ? 409 : 500 },
    );
  }

  // Включение правила пишется в журнал наравне с разовой сменой ставки: с этой
  // секунды ставку меняет машина, и вопрос «кто это включил и когда» возникает
  // ровно тогда, когда ставка уже уехала. Сохранение выключенного правила в
  // журнал не идёт — оно ещё ничего не делает.
  if (row.enabled) {
    await auditAdvertOperation({
      context: resolved.context,
      advertId,
      action: "rule_enable",
      status: "ok",
      oldValue: null,
      newValue: { goal, target, stepPercent, minBid, maxBid, minOrders, windowDays, placement, nmId },
      wbResult: { ruleId: data?.id ?? null },
    });
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null, enabled: row.enabled });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Нужен id правила" }, { status: 400 });

  const gate = await resolveAdvertCabinetAccess(body.cabinetId);
  if (gate.response) return gate.response;
  const { db, cabinet, session } = gate.access;

  // Читаем правило до удаления: после него сказать в журнале, ЧТО именно
  // удалили, будет уже не из чего, а строка «удалено правило» без содержания
  // ничем не помогает через месяц.
  const { data: before } = await db
    .from("advert_rules")
    .select("advert_id, nm_id, placement, goal, target, min_bid, max_bid, enabled")
    .eq("id", id)
    .eq("cabinet_id", cabinet.id)
    .maybeSingle();

  const { error } = await db.from("advert_rules").delete().eq("id", id).eq("cabinet_id", cabinet.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (before) {
    await auditAdvertOperation({
      context: { session, db, cabinet, token: gate.access.token, adverts: new Map() },
      advertId: Number(before.advert_id),
      action: "rule_delete",
      status: "ok",
      oldValue: before,
      newValue: null,
      wbResult: { ruleId: id },
    });
  }
  return NextResponse.json({ ok: true });
}
