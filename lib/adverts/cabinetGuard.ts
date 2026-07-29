import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import type { Session } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinet, resolveWbToken, type WbCabinet } from "@/lib/wb/cabinetTokens";

interface AdvertOwnershipRow {
  advert_id: number;
  cabinet_id: string | null;
  status: number | null;
  daily_budget: number | null;
  bid_cpm_rub?: number | null;
}

export interface AdvertCabinetContext {
  session: Session;
  db: SupabaseClient;
  cabinet: WbCabinet;
  token: string;
  adverts: Map<number, AdvertOwnershipRow>;
}

export interface AdvertAuditInput {
  context: AdvertCabinetContext;
  advertId: number;
  action: string;
  status: "ok" | "error" | "rejected";
  oldValue?: unknown;
  newValue?: unknown;
  wbResult?: unknown;
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function safeDetail(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  try {
    return JSON.stringify(value ?? null).slice(0, 500);
  } catch {
    return "не удалось сериализовать результат";
  }
}

/**
 * Проверяет сессию, роль, выбранный кабинет и принадлежность всех кампаний до
 * любого запроса в WB. Токен остаётся только в серверном контексте.
 */
export async function resolveAdvertCabinetContext(input: {
  cabinetId: unknown;
  advertIds: number[];
}): Promise<{ context: AdvertCabinetContext; response?: never } | { context?: never; response: NextResponse }> {
  const session = await getServerSession();
  if (!session) return { response: error("Требуется вход", 401) };
  if (session.role !== "director" && session.role !== "manager") {
    return { response: error("Недостаточно прав для управления рекламой", 403) };
  }
  const cabinetId = typeof input.cabinetId === "string" ? input.cabinetId.trim() : "";
  if (!cabinetId || cabinetId === "all") return { response: error("Нужно выбрать один WB-кабинет", 400) };
  if (!sessionHasCabinetAccess(session, cabinetId)) return { response: error("Нет доступа к кабинету", 403) };
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet || !cabinet.is_active) return { response: error("WB-кабинет не найден", 404) };
  const token = resolveWbToken(cabinet, "advert") || process.env.WB_TOKEN_ADVERT || "";
  if (!token) return { response: error("У кабинета нет токена Продвижения", 400) };
  const db = getSupabaseAdmin();
  if (!db) return { response: error("Supabase не настроен", 500) };

  const ids = [...new Set(input.advertIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return { response: error("Не указана рекламная кампания", 400) };
  const extendedQuery = await db
    .from("wb_adverts")
    .select("advert_id, cabinet_id, status, daily_budget, bid_cpm_rub")
    .in("advert_id", ids);
  let rows = (extendedQuery.data ?? []) as AdvertOwnershipRow[];
  let queryError = extendedQuery.error;
  if (extendedQuery.error?.code === "42703") {
    const legacyQuery = await db
      .from("wb_adverts")
      .select("advert_id, cabinet_id, status, daily_budget")
      .in("advert_id", ids);
    rows = (legacyQuery.data ?? []) as AdvertOwnershipRow[];
    queryError = legacyQuery.error;
  }
  if (queryError) return { response: error(queryError.message, 500) };
  const found = new Set(rows.map((row) => Number(row.advert_id)));
  if (ids.some((id) => !found.has(id))) return { response: error("Рекламная кампания не найдена", 404) };
  if (rows.some((row) => row.cabinet_id !== cabinetId)) {
    return { response: error("Кампания принадлежит другому кабинету", 403) };
  }

  return {
    context: {
      session,
      db,
      cabinet,
      token,
      adverts: new Map(rows.map((row) => [Number(row.advert_id), row])),
    },
  };
}

export async function auditAdvertOperation(input: AdvertAuditInput): Promise<void> {
  const oldBid = input.action === "bid" && typeof input.oldValue === "number" ? input.oldValue : null;
  const newBid = input.action === "bid" && typeof input.newValue === "number" ? input.newValue : null;
  const detail = safeDetail(input.wbResult);
  const extended = await input.context.db.from("advert_bid_changes").insert({
    advert_id: input.advertId,
    cabinet_id: input.context.cabinet.id,
    user_id: input.context.session.uid || null,
    user_email: input.context.session.email,
    action: input.action,
    old_bid: oldBid,
    new_bid: newBid,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    status: input.status,
    detail,
    wb_result: input.wbResult ?? null,
  });
  if (extended.error?.code === "42703" || extended.error?.code === "PGRST204") {
    await input.context.db.from("advert_bid_changes").insert({
      advert_id: input.advertId,
      old_bid: oldBid,
      new_bid: newBid,
      status: input.status,
      detail: `${input.action}: ${detail}`.slice(0, 500),
    });
  }
}
