import { NextRequest, NextResponse } from "next/server";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import {
  canModerateSalesPlan,
  createEmptySalesPlan,
  getApprovedSalesPlanForMonth,
  getSalesPlanMonthState,
  normalizeSalesPlanAction,
  normalizeSalesPlanDocument,
  normalizeSalesPlanMonthKey,
  normalizeSalesPlanReturnComment,
  setSalesPlanMonthState,
  type SalesPlanDocument,
  type SalesPlanEnvelope,
  summarizeSalesPlanStatus,
  validateSalesPlan,
  type SalesPlanMarketplace,
} from "@/lib/planning/salesPlan";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type StoredState = Record<string, unknown> & {
  sales_plan_v1?: Partial<Record<SalesPlanMarketplace, Record<string, unknown>>>;
};

function isMarketplace(value: string | null): value is SalesPlanMarketplace {
  return value === "wb" || value === "ozon";
}
function asEnvelope(
  value: unknown,
  context: { marketplace: SalesPlanMarketplace; cabinetId: string; year: number },
): SalesPlanEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { working: null, approved: null, approvedByMonth: {} };
  const source = value as Record<string, unknown>;
  if (source.schemaVersion === 1) {
    const plan = normalizeSalesPlanDocument(source, context);
    return { working: plan, approved: plan.status === "approved" ? plan : null, approvedByMonth: {} };
  }
  const approvedByMonthSource = source.approvedByMonth && typeof source.approvedByMonth === "object" && !Array.isArray(source.approvedByMonth)
    ? source.approvedByMonth as Record<string, unknown>
    : {};
  const approvedByMonth = Object.fromEntries(
    Object.entries(approvedByMonthSource)
      .map(([monthKey, document]) => [normalizeSalesPlanMonthKey(monthKey), normalizeSalesPlanDocument(document, context)] as const)
      .filter(([monthKey]) => monthKey),
  );
  return {
    working: source.working ? normalizeSalesPlanDocument(source.working, context) : null,
    approved: source.approved ? normalizeSalesPlanDocument(source.approved, context) : null,
    approvedByMonth,
  };
}

function readEnvelope(
  state: StoredState,
  context: { marketplace: SalesPlanMarketplace; cabinetId: string; year: number },
) {
  return asEnvelope(state.sales_plan_v1?.[context.marketplace]?.[context.cabinetId], context);
}

function mergeEnvelope(
  state: StoredState,
  context: { marketplace: SalesPlanMarketplace; cabinetId: string; year: number },
  envelope: SalesPlanEnvelope,
): StoredState {
  return {
    ...state,
    sales_plan_v1: {
      ...(state.sales_plan_v1 ?? {}),
      [context.marketplace]: {
        ...(state.sales_plan_v1?.[context.marketplace] ?? {}),
        [context.cabinetId]: envelope,
      },
    },
  };
}

async function resolveContext(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return { error: "Не авторизовано", status: 401 } as const;

  const params = new URL(request.url).searchParams;
  const marketplace = params.get("marketplace");
  const cabinetId = params.get("cabinet")?.trim() ?? "";
  const year = Math.min(2100, Math.max(2020, Number(params.get("year")) || new Date().getFullYear()));
  if (!isMarketplace(marketplace)) return { error: "marketplace должен быть wb или ozon", status: 400 } as const;
  if (!cabinetId || cabinetId === "all" || cabinetId.startsWith("group:")) {
    return { error: "Для плана выберите один кабинет", status: 400 } as const;
  }
  if (!sessionHasCabinetAccess(session, cabinetId)) return { error: "Нет доступа к кабинету", status: 403 } as const;
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен", status: 500 } as const;
  const { data: cabinet, error } = await db
    .from("wb_cabinets")
    .select("id, name, marketplace")
    .eq("id", cabinetId)
    .eq("marketplace", marketplace)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 } as const;
  if (!cabinet) return { error: `Активный кабинет ${marketplace.toUpperCase()} не найден`, status: 404 } as const;
  return {
    db,
    context: { marketplace, cabinetId, year },
    cabinetName: String(cabinet.name || marketplace.toUpperCase()),
    session,
  } as const;
}

async function loadState(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, year: number) {
  const { data, error } = await db.from("planning_state").select("data").eq("year", year).maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.data ?? {}) as StoredState);
}

export async function GET(request: NextRequest) {
  const resolved = await resolveContext(request);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  try {
    const state = await loadState(resolved.db, resolved.context.year);
    const envelope = readEnvelope(state, resolved.context);
    const monthKey = normalizeSalesPlanMonthKey(new URL(request.url).searchParams.get("monthKey") ?? new URL(request.url).searchParams.get("month"));
    return NextResponse.json({
      plan: envelope.working,
      approvedPlan: monthKey ? getApprovedSalesPlanForMonth(envelope, monthKey) : envelope.approved,
      approvedByMonth: envelope.approvedByMonth,
      cabinet: resolved.cabinetName,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить план" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveContext(request);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const body = await request.json().catch(() => ({})) as {
    action?: unknown;
    expectedRevision?: number;
    monthKey?: unknown;
    month?: unknown;
    comment?: unknown;
    plan?: unknown;
  };
  const action = normalizeSalesPlanAction(body.action);
  if (!action) return NextResponse.json({ error: "Неизвестное действие плана" }, { status: 400 });
  const monthKey = normalizeSalesPlanMonthKey(body.monthKey ?? body.month);
  if (action !== "save" && !monthKey) return NextResponse.json({ error: "Укажите месяц согласования" }, { status: 400 });

  const elevated = canModerateSalesPlan(resolved.session);
  const actor = resolved.session.email;

  try {
    const state = await loadState(resolved.db, resolved.context.year);
    const currentEnvelope = readEnvelope(state, resolved.context);
    const current = currentEnvelope.working;
    const expectedRevision = Math.max(0, Math.round(Number(body.expectedRevision) || 0));
    if ((current?.revision ?? 0) !== expectedRevision) {
      return NextResponse.json(
        { error: "План изменился в другой вкладке. Обновите данные перед продолжением.", conflict: true, plan: current, approvedPlan: currentEnvelope.approved },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    let next: SalesPlanDocument;
    let approved = currentEnvelope.approved;
    let approvedByMonth = currentEnvelope.approvedByMonth;

    if (action === "approve") {
      if (!elevated) return NextResponse.json({ error: "Утверждение доступно руководителю или финотделу" }, { status: 403 });
      if (!current || getSalesPlanMonthState(current, monthKey).status !== "review") return NextResponse.json({ error: "На утверждение можно отправить только месяц на согласовании" }, { status: 409 });
      const issues = validateSalesPlan(current);
      if (issues.length) return NextResponse.json({ error: "План содержит ошибки", issues }, { status: 422 });
      const monthState = getSalesPlanMonthState(current, monthKey);
      next = setSalesPlanMonthState(
        { ...current, revision: current.revision + 1, updatedAt: now, approvedAt: now, approvedBy: actor, returnedAt: null, returnedBy: null, returnComment: null, rnpSyncedAt: now },
        monthKey,
        { ...monthState, status: "approved", revision: monthState.revision + 1, approvedAt: now, approvedBy: actor, returnedAt: null, returnedBy: null, returnComment: null, rnpSyncedAt: now },
      );
      approved = next;
      approvedByMonth = { ...approvedByMonth, [monthKey]: next };
    } else if (action === "return") {
      if (!elevated) return NextResponse.json({ error: "Возврат доступен руководителю или финотделу" }, { status: 403 });
      if (!current || getSalesPlanMonthState(current, monthKey).status !== "review") return NextResponse.json({ error: "Вернуть можно только месяц на согласовании" }, { status: 409 });
      const returnComment = normalizeSalesPlanReturnComment(body.comment);
      if (!returnComment) return NextResponse.json({ error: "Укажите комментарий возврата: что исправить в плане" }, { status: 422 });
      const monthState = getSalesPlanMonthState(current, monthKey);
      next = setSalesPlanMonthState(
        { ...current, revision: current.revision + 1, updatedAt: now, returnedAt: now, returnedBy: actor, returnComment },
        monthKey,
        { ...monthState, status: "draft", revision: monthState.revision + 1, returnedAt: now, returnedBy: actor, returnComment },
      );
    } else if (action === "new_version") {
      if (!elevated) return NextResponse.json({ error: "Новая версия доступна руководителю или финотделу" }, { status: 403 });
      const approvedSource = getApprovedSalesPlanForMonth(currentEnvelope, monthKey);
      if (!approvedSource) return NextResponse.json({ error: "Нет утверждённой версии месяца для копирования" }, { status: 409 });
      const monthState = getSalesPlanMonthState(approvedSource, monthKey);
      next = setSalesPlanMonthState({
        ...(current ?? approvedSource),
        revision: (current?.revision ?? approvedSource.revision) + 1,
        responsible: actor,
        updatedAt: now,
      }, monthKey, {
        ...monthState,
        status: "draft",
        version: monthState.version + 1,
        revision: monthState.revision + 1,
        submittedAt: null,
        submittedBy: null,
        approvedAt: null,
        approvedBy: null,
        returnedAt: null,
        returnedBy: null,
        returnComment: null,
        rnpSyncedAt: null,
      });
    } else {
      if (current && monthKey && getSalesPlanMonthState(current, monthKey).status !== "draft") {
        return NextResponse.json({ error: "Заблокированный месяц нельзя редактировать. Создайте новую версию." }, { status: 423 });
      }
      const source = body.plan ?? current ?? createEmptySalesPlan({ ...resolved.context, responsible: actor });
      const incoming = normalizeSalesPlanDocument(source, resolved.context);
      incoming.responsible ||= current?.responsible || actor;
      incoming.version = current?.version ?? incoming.version;
      incoming.createdAt = current?.createdAt ?? incoming.createdAt;
      incoming.approvedAt = null;
      incoming.approvedBy = null;
      incoming.submittedAt = current?.submittedAt ?? incoming.submittedAt;
      incoming.submittedBy = current?.submittedBy ?? incoming.submittedBy;
      incoming.returnedAt = current?.returnedAt ?? incoming.returnedAt;
      incoming.returnedBy = current?.returnedBy ?? incoming.returnedBy;
      incoming.returnComment = current?.returnComment ?? incoming.returnComment;
      incoming.rnpSyncedAt = null;
      const issues = validateSalesPlan(incoming);
      if (action === "submit" && issues.length) {
        return NextResponse.json({ error: "Исправьте ошибки перед согласованием", issues }, { status: 422 });
      }
      next = normalizeSalesPlanDocument({
        ...incoming,
        status: summarizeSalesPlanStatus(incoming),
        revision: (current?.revision ?? 0) + 1,
        updatedAt: now,
      }, resolved.context);
      if (action === "submit") {
        const monthState = getSalesPlanMonthState(next, monthKey);
        next = setSalesPlanMonthState(
          { ...next, submittedAt: now, submittedBy: actor, returnedAt: null, returnedBy: null, returnComment: null },
          monthKey,
          { ...monthState, status: "review", revision: monthState.revision + 1, submittedAt: now, submittedBy: actor, returnedAt: null, returnedBy: null, returnComment: null },
        );
      }
    }

    const envelope = { working: next, approved, approvedByMonth } satisfies SalesPlanEnvelope;
    const merged = mergeEnvelope(state, resolved.context, envelope);
    const { error } = await resolved.db
      .from("planning_state")
      .upsert({ year: resolved.context.year, data: merged, updated_at: now }, { onConflict: "year" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, plan: next, approvedPlan: monthKey ? getApprovedSalesPlanForMonth(envelope, monthKey) : approved, approvedByMonth });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить план" }, { status: 500 });
  }
}
