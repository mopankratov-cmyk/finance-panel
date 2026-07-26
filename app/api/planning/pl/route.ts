import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import {
  mergePlanningBlock,
  normalizePlanningBlock,
  selectPlanningBlock,
  type PlanningBlock,
  type PlanningState,
} from "@/lib/planning/state";
import { loadPlanningState, writePlanningStateSnapshot } from "@/lib/planning/stateStore";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const PLANNING_STATE_SAVE_ATTEMPTS = 3;

type SavePlanningBlockResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

async function savePlanningBlockWithRetry(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  year: number,
  cabinetId: string | null,
  block: PlanningBlock,
): Promise<SavePlanningBlockResult> {
  let snapshot = await loadPlanningState<PlanningState>(db, year);

  for (let attempt = 0; attempt < PLANNING_STATE_SAVE_ATTEMPTS; attempt += 1) {
    const data = mergePlanningBlock(snapshot.data, cabinetId, block);
    const result = await writePlanningStateSnapshot(db, year, snapshot, data, new Date().toISOString());

    if (result.ok) return { ok: true };
    if ("error" in result) return { ok: false, error: result.error, status: 500 };

    snapshot = await loadPlanningState<PlanningState>(db, year);
  }

  return { ok: false, error: "План изменился во время сохранения. Обновите данные и повторите.", status: 409 };
}

// Контракт inferno: GET → {orders:[12], norms:{}, sku_orders:{art:[12]}}; POST сохраняет блок целиком.
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const { cabinetId } = await resolveShopCabinet(params.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ orders: Array(12).fill(0), norms: {}, sku_orders: {} });
  const year = Number(params.get("year")) || new Date().getFullYear();
  try {
    const snapshot = await loadPlanningState<PlanningState>(db, year);
    return NextResponse.json(selectPlanningBlock(snapshot.data, cabinetId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить план" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const { cabinetId } = await resolveShopCabinet(params.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  const year = Number(b.year) || new Date().getFullYear();
  const block = normalizePlanningBlock({ orders: b.orders, norms: b.norms, sku_orders: b.sku_orders });
  try {
    const result = await savePlanningBlockWithRetry(db, year, cabinetId, block);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить план" }, { status: 500 });
  }
}
