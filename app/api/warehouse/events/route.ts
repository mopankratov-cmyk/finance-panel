import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import {
  CHANGE_KINDS,
  isEventKind,
  toEventRow,
  type WarehouseEventKind,
  type WarehouseEventsResponse,
} from "@/lib/warehouse/events";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 2000;
/** Сводка по людям считается по всей выборке за период, но не бесконечно. */
const SUMMARY_MAX_PAGES = 20;
const NO_ACTOR = "—";

interface DbError {
  message: string;
  code?: string;
}

interface DbEventBrief {
  actor: string | null;
  actor_role: string | null;
  kind: string;
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const isMissingMigration = (code?: string | null) =>
  ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"].includes(code ?? "");
const MIGRATION_HINT = "Примените миграции 202609040002_warehouse_flow.sql и 202609040003_warehouse_flow_functions.sql";
const dbFail = (error: DbError) =>
  fail(isMissingMigration(error.code) ? MIGRATION_HINT : error.message, isMissingMigration(error.code) ? 503 : 500);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Лента событий склада и журнал правок по людям (п. 5–6 ТЗ).
 *
 * Фильтры actor/kind/changes сужают ленту, а сводка «по пользователям»
 * считается по всему периоду без них: она отвечает на вопрос «кто что делал»,
 * и выбранный в ленте человек не должен исчезать из сравнения с остальными.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const url = new URL(request.url);
  const scope = await resolveEntity(url.searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const actor = url.searchParams.get("actor")?.trim() || null;
  const kindParam = url.searchParams.get("kind")?.trim() || null;
  if (kindParam && !isEventKind(kindParam)) return fail("Неизвестный вид события", 400);
  const kind: WarehouseEventKind | null = kindParam && isEventKind(kindParam) ? kindParam : null;
  const from = url.searchParams.get("from")?.trim() || null;
  const to = url.searchParams.get("to")?.trim() || null;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return fail("Даты — в формате ГГГГ-ММ-ДД", 400);
  // Оба написания: в контракте changes=1, в проекте onlyChanges=1.
  const onlyChanges = url.searchParams.get("changes") === "1" || url.searchParams.get("onlyChanges") === "1";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(MAX_LIMIT, Math.floor(limitParam)) : DEFAULT_LIMIT;

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const warehousesResult = await db.from("warehouses").select("id, name");
  const names = new Map((warehousesResult.data ?? []).map((row) => [String(row.id), String(row.name)]));

  let feed = db
    .from("warehouse_events")
    .select("id, kind, ref_type, ref_id, number, warehouse_id, actor, actor_role, occurred_at, payload, changes")
    .eq("legal_entity_id", scope.entity.id);
  if (from) feed = feed.gte("occurred_at", from);
  if (to) feed = feed.lt("occurred_at", nextDay(to));
  if (actor) feed = feed.eq("actor", actor);
  if (kind) feed = feed.eq("kind", kind);
  if (onlyChanges) feed = feed.in("kind", [...CHANGE_KINDS]);
  const feedResult = await feed.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (feedResult.error) return dbFail(feedResult.error);
  const rows = ((feedResult.data ?? []) as Record<string, unknown>[]).map((raw) => toEventRow(raw, names));

  // Сводка — по той же выборке за период, но без фильтров по человеку и виду.
  // Если событий за период больше безопасного лимита, считаем по тому, что
  // успели прочитать, — сводка вспомогательная, ронять из-за неё ленту нельзя.
  let brief: DbEventBrief[];
  try {
    brief = await loadAllSupabasePages<DbEventBrief>(
      (start, end) => {
        let query = db
          .from("warehouse_events")
          .select("actor, actor_role, kind")
          .eq("legal_entity_id", scope.entity.id);
        if (from) query = query.gte("occurred_at", from);
        if (to) query = query.lt("occurred_at", nextDay(to));
        return query.order("id", { ascending: false }).range(start, end);
      },
      { label: "События", maxPages: SUMMARY_MAX_PAGES, concurrency: 2 },
    );
  } catch {
    brief = rows.map((row) => ({ actor: row.actor, actor_role: row.actorRole, kind: row.kind }));
  }

  const byActor = new Map<string, WarehouseEventsResponse["byActor"][number]>();
  for (const item of brief) {
    const key = item.actor ? String(item.actor) : NO_ACTOR;
    const bucket = byActor.get(key) ?? { actor: key, actorRole: item.actor_role ? String(item.actor_role) : null, kinds: {}, total: 0, changes: 0 };
    if (isEventKind(item.kind)) {
      bucket.kinds[item.kind] = (bucket.kinds[item.kind] ?? 0) + 1;
      if (CHANGE_KINDS.has(item.kind)) bucket.changes += 1;
    }
    bucket.total += 1;
    if (!bucket.actorRole && item.actor_role) bucket.actorRole = String(item.actor_role);
    byActor.set(key, bucket);
  }

  const payload: WarehouseEventsResponse = {
    rows,
    byActor: [...byActor.values()].sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor, "ru")),
    actors: [...byActor.keys()].filter((key) => key !== NO_ACTOR).sort((a, b) => a.localeCompare(b, "ru")),
    truncated: rows.length >= limit,
  };
  return NextResponse.json({ data: payload, error: null });
}
