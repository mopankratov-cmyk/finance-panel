import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import type { Session } from "@/lib/auth/session";
import { cabinetRights } from "@/lib/auth/cabinetLevel";
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

/** Кабинет и право в нём — без привязки к конкретной кампании. */
export interface AdvertCabinetAccess {
  session: Session;
  db: SupabaseClient;
  cabinet: WbCabinet;
  token: string;
}

/**
 * Доступ к кабинету Продвижения: сессия, роль, доступ к кабинету, право менять
 * деньги в нём и наличие токена.
 *
 * Вынесено отдельно от проверки владения кампанией, потому что часть операций
 * кампании ещё не имеет: создание заводит её впервые, а справка по кабинету
 * (баланс, валюта, шаг ставки) не относится ни к одной. Раньше такой вызов
 * пришлось бы подпирать несуществующим advertId — то есть проходить проверку,
 * притворяясь, что проверяешь что-то другое.
 */
export async function resolveAdvertCabinetAccess(
  cabinetIdInput: unknown,
): Promise<{ access: AdvertCabinetAccess; response?: never } | { access?: never; response: NextResponse }> {
  const session = await getServerSession();
  if (!session) return { response: error("Требуется вход", 401) };
  if (session.role !== "director" && session.role !== "manager") {
    return { response: error("Недостаточно прав для управления рекламой", 403) };
  }
  const cabinetId = typeof cabinetIdInput === "string" ? cabinetIdInput.trim() : "";
  if (!cabinetId || cabinetId === "all") return { response: error("Нужно выбрать один WB-кабинет", 400) };
  if (!sessionHasCabinetAccess(session, cabinetId)) return { response: error("Нет доступа к кабинету", 403) };
  // Уровень В КАБИНЕТЕ сильнее глобальной роли: менеджер кабинета ведёт задачи
  // и заметки, но ставки и статусы кампаний меняет руководитель. Проверка здесь,
  // а не только в интерфейсе: спрятанная кнопка это не защита.
  const rights = await cabinetRights(cabinetId);
  if (!rights.canOperate) {
    return { response: error("В этом кабинете у вас менеджерский доступ: ставки и статусы кампаний меняет руководитель", 403) };
  }
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet || !cabinet.is_active) return { response: error("WB-кабинет не найден", 404) };
  const token = resolveWbToken(cabinet, "advert") || process.env.WB_TOKEN_ADVERT || "";
  if (!token) return { response: error("У кабинета нет токена Продвижения", 400) };
  const db = getSupabaseAdmin();
  if (!db) return { response: error("Supabase не настроен", 500) };

  return { access: { session, db, cabinet, token } };
}

/**
 * Проверяет сессию, роль, выбранный кабинет и принадлежность всех кампаний до
 * любого запроса в WB. Токен остаётся только в серверном контексте.
 */
export async function resolveAdvertCabinetContext(input: {
  cabinetId: unknown;
  advertIds: number[];
}): Promise<{ context: AdvertCabinetContext; response?: never } | { context?: never; response: NextResponse }> {
  const gate = await resolveAdvertCabinetAccess(input.cabinetId);
  if (gate.response) return { response: gate.response };
  const { session, db, cabinet, token } = gate.access;
  const cabinetId = cabinet.id;

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
