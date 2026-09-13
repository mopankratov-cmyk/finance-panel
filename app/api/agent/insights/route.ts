import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { isExternalRole } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export interface AgentInsight {
  id: number;
  module: string;
  severity: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  cabinet_id?: string | null;
}

const COLS = "id, module, severity, title, body, is_read, created_at, cabinet_id";
const COLS_LEGACY = "id, module, severity, title, body, is_read, created_at";

/**
 * Отфильтровать инсайты по доступу текущей сессии к их кабинету.
 *
 * cabinet_id IS NULL — общий инсайт по компании (rules-движок, сводки не по
 * одному SKU): виден только внутренним ролям, никогда внешнему контуру.
 * Иначе — hasCabinetAccess решает, как и везде в панели.
 */
async function filterByCabinetAccess<T extends { cabinet_id?: string | null }>(rows: T[]): Promise<T[]> {
  const session = await getServerSession();
  const external = isExternalRole(session?.role);
  const distinctCabinetIds = [...new Set(rows.map((r) => r.cabinet_id).filter((id): id is string => Boolean(id)))];
  const accessByCabinet = new Map(
    await Promise.all(distinctCabinetIds.map(async (id) => [id, await hasCabinetAccess(id)] as const)),
  );
  return rows.filter((r) => (r.cabinet_id ? accessByCabinet.get(r.cabinet_id) === true : !external));
}

export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));

  // Читаем с запасом: часть строк отсеется проверкой доступа ниже, а лимит —
  // это лимит на ОТДАННОЕ, а не на прочитанное из базы.
  let data: Record<string, unknown>[] | null;
  let error: { code?: string; message: string } | null;
  ({ data, error } = await db
    .from("agent_insights")
    .select(COLS)
    .order("created_at", { ascending: false })
    .limit(limit * 4));
  let hasCabinetColumn = true;
  if (error?.code === "42703") {
    // Миграция 202609130001_agent_insights_cabinet_scope ещё не применена —
    // колонки нет, фильтровать нечем. До применения ведём себя как раньше.
    hasCabinetColumn = false;
    ({ data, error } = await db
      .from("agent_insights")
      .select(COLS_LEGACY)
      .order("created_at", { ascending: false })
      .limit(limit));
  }
  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }
  let rows = (data ?? []) as unknown as AgentInsight[];
  if (hasCabinetColumn) {
    // Раньше GET отдавал ВСЕ строки любой сессии с analytics.view — внешний
    // seller_owner любой организации видел инсайты чужих кабинетов и чужих
    // организаций одним запросом. Теперь фильтруем по доступу до отдачи.
    rows = (await filterByCabinetAccess(rows)).slice(0, limit);
  }

  const unread = rows.filter((r) => !r.is_read).length;
  return NextResponse.json({ data: rows, unread, error: null });
}

// Пометить инсайты прочитанными (все или по id) — только те, что сессия видит.
export async function PATCH(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const byIds = Array.isArray(body.ids) && body.ids.length;

  let selectQuery = db.from("agent_insights").select("id, cabinet_id");
  selectQuery = byIds ? selectQuery.in("id", body.ids) : selectQuery.eq("is_read", false);
  const { data: candidates, error: selectError } = await selectQuery;

  if (selectError?.code === "42703") {
    // Миграция ещё не применена — колонки нет, отмечаем как раньше, без разреза.
    const q = db.from("agent_insights").update({ is_read: true });
    const { error } = byIds ? await q.in("id", body.ids) : await q.eq("is_read", false);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 });

  // Раньше PATCH без ?ids отмечал прочитанными ВСЕ непрочитанные строки в
  // таблице разом, включая чужие (не утечка данных, но чужая запись). Метим
  // только те id, что сессия реально видит по тем же правилам, что и GET.
  const allowedIds = (await filterByCabinetAccess(
    (candidates ?? []) as { id: number; cabinet_id: string | null }[],
  )).map((r) => r.id);
  if (!allowedIds.length) return NextResponse.json({ ok: true });

  const { error } = await db.from("agent_insights").update({ is_read: true }).in("id", allowedIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
