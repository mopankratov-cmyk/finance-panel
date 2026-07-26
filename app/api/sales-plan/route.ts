import { NextRequest, NextResponse } from "next/server";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import {
  canModerateSalesPlan,
  createEmptySalesPlan,
  normalizeSalesPlanAction,
  normalizeSalesPlanDocument,
  type SalesPlanDocument,
  type SalesPlanEnvelope,
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return { working: null, approved: null };
  const source = value as Record<string, unknown>;
  if (source.schemaVersion === 1) {
    const plan = normalizeSalesPlanDocument(source, context);
    return { working: plan, approved: plan.status === "approved" ? plan : null };
  }
  return {
    working: source.working ? normalizeSalesPlanDocument(source.working, context) : null,
    approved: source.approved ? normalizeSalesPlanDocument(source.approved, context) : null,
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
    return NextResponse.json({
      plan: envelope.working,
      approvedPlan: envelope.approved,
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
    plan?: unknown;
  };
  const action = normalizeSalesPlanAction(body.action);
  if (!action) return NextResponse.json({ error: "Неизвестное действие плана" }, { status: 400 });

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

    if (action === "approve") {
      if (!elevated) return NextResponse.json({ error: "Утверждение доступно руководителю или финотделу" }, { status: 403 });
      if (!current || current.status !== "review") return NextResponse.json({ error: "На утверждение можно отправить только согласованный план" }, { status: 409 });
      const issues = validateSalesPlan(current);
      if (issues.length) return NextResponse.json({ error: "План содержит ошибки", issues }, { status: 422 });
      next = { ...current, status: "approved", revision: current.revision + 1, updatedAt: now, approvedAt: now, approvedBy: actor, rnpSyncedAt: now };
      approved = next;
    } else if (action === "return") {
      if (!elevated) return NextResponse.json({ error: "Возврат доступен руководителю или финотделу" }, { status: 403 });
      if (!current || current.status !== "review") return NextResponse.json({ error: "Вернуть можно только план на согласовании" }, { status: 409 });
      next = { ...current, status: "draft", revision: current.revision + 1, updatedAt: now };
    } else if (action === "new_version") {
      if (!elevated) return NextResponse.json({ error: "Новая версия доступна руководителю или финотделу" }, { status: 403 });
      if (!currentEnvelope.approved) return NextResponse.json({ error: "Нет утверждённой версии для копирования" }, { status: 409 });
      next = {
        ...currentEnvelope.approved,
        version: currentEnvelope.approved.version + 1,
        revision: currentEnvelope.approved.revision + 1,
        status: "draft",
        responsible: actor,
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
        approvedBy: null,
        rnpSyncedAt: null,
      };
    } else {
      if (current && current.status !== "draft") {
        return NextResponse.json({ error: "Заблокированный план нельзя редактировать. Создайте новую версию." }, { status: 423 });
      }
      const source = body.plan ?? current ?? createEmptySalesPlan({ ...resolved.context, responsible: actor });
      const incoming = normalizeSalesPlanDocument(source, resolved.context);
      incoming.responsible ||= current?.responsible || actor;
      incoming.version = current?.version ?? incoming.version;
      incoming.createdAt = current?.createdAt ?? incoming.createdAt;
      incoming.approvedAt = null;
      incoming.approvedBy = null;
      incoming.rnpSyncedAt = null;
      const issues = validateSalesPlan(incoming);
      if (action === "submit" && issues.length) {
        return NextResponse.json({ error: "Исправьте ошибки перед согласованием", issues }, { status: 422 });
      }
      next = {
        ...incoming,
        status: action === "submit" ? "review" : "draft",
        revision: (current?.revision ?? 0) + 1,
        updatedAt: now,
      };
    }

    const envelope = { working: next, approved } satisfies SalesPlanEnvelope;
    const merged = mergeEnvelope(state, resolved.context, envelope);
    const { error } = await resolved.db
      .from("planning_state")
      .upsert({ year: resolved.context.year, data: merged, updated_at: now }, { onConflict: "year" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, plan: next, approvedPlan: approved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить план" }, { status: 500 });
  }
}
