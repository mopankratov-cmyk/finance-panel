import { NextResponse, type NextRequest } from "next/server";

import { advertActionLabel } from "@/lib/adverts/actionCatalog";
import { resolveAdvertCabinetAccess } from "@/lib/adverts/cabinetGuard";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

export interface AdvertJournalEntry {
  id: number;
  advertId: number;
  advertName: string | null;
  action: string;
  actionLabel: string;
  status: string;
  userEmail: string | null;
  oldValue: unknown;
  newValue: unknown;
  detail: string | null;
  createdAt: string;
}

interface JournalRow {
  id: number;
  advert_id: number;
  action: string | null;
  status: string | null;
  user_email: string | null;
  old_value: unknown;
  new_value: unknown;
  detail: string | null;
  created_at: string;
}

/**
 * Журнал действий модуля: что сделали, кто, когда, что было и что стало.
 *
 * Отклонённые попытки (`rejected`) показываются наравне с выполненными, и это
 * главное отличие от прежней истории ставок. Успешные операции рассказывают,
 * что происходило с рекламой; отклонённые — что человек пытался сделать, но
 * предохранитель не пустил. Второе важнее: три отказа подряд по суточному
 * лимиту означают, что либо лимит занижен, либо кто-то пытается обойти его
 * повторами, и оба разговора невозможны, если отказы не видны.
 *
 * Названия кампаний подтягиваются отдельным запросом, а не join'ом: кампанию
 * могли завершить и вычистить из wb_adverts, а строка журнала должна пережить
 * свою кампанию. Не нашли имя — показываем ID, а не прячем запись.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const gate = await resolveAdvertCabinetAccess(params.get("cabinet"));
  if (gate.response) return gate.response;
  const { db, cabinet } = gate.access;

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || 50));
  const action = params.get("action");
  const status = params.get("status");
  const advertId = Number(params.get("advertId"));

  let query = db
    .from("advert_bid_changes")
    .select("id, advert_id, action, status, user_email, old_value, new_value, detail, created_at")
    .eq("cabinet_id", cabinet.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (action) query = query.eq("action", action);
  if (status) query = query.eq("status", status);
  if (Number.isInteger(advertId) && advertId > 0) query = query.eq("advert_id", advertId);

  const { data, error } = await query;
  if (error) {
    // Расширенные колонки журнала заводит миграция 20260714. Пока её нет,
    // читать нечего — но сказать об этом прямо лучше, чем отдать пустой список
    // и оставить человека думать, что действий не было.
    const missingColumns = error.code === "42703";
    return NextResponse.json(
      {
        entries: [],
        error: missingColumns
          ? "Журнал не развёрнут: не применена миграция 20260714_wb_data_reliability.sql"
          : error.message,
      },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as JournalRow[];
  const ids = [...new Set(rows.map((row) => Number(row.advert_id)).filter((id) => id > 0))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: adverts } = await db
      .from("wb_adverts")
      .select("advert_id, name")
      .eq("cabinet_id", cabinet.id)
      .in("advert_id", ids);
    for (const row of adverts ?? []) {
      if (row.name) names.set(Number(row.advert_id), String(row.name));
    }
  }

  const entries: AdvertJournalEntry[] = rows.map((row) => {
    const code = row.action ?? "bid";
    return {
      id: row.id,
      advertId: Number(row.advert_id),
      advertName: names.get(Number(row.advert_id)) ?? null,
      action: code,
      actionLabel: advertActionLabel(code),
      status: row.status ?? "ok",
      userEmail: row.user_email,
      oldValue: row.old_value,
      newValue: row.new_value,
      detail: row.detail,
      createdAt: row.created_at,
    };
  });

  return NextResponse.json({ entries, cabinet: { id: cabinet.id, name: cabinet.name } });
}
