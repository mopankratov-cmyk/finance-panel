// Лента событий склада.
//
// Регистр движений знает, что случилось с остатком, но не знает, кто и когда
// «поставил задание», «пересчитал», «скорректировал». ТЗ команды просит именно
// это: хронику с датой, статусом и пользователем, и журнал правок по людям.
// События пишутся из API-роутов рядом с операцией — и НИКОГДА не роняют её:
// проводка уже прошла, и отказать человеку из-за незаписанной строки хроники
// значило бы соврать про неудачу.
//
// В базе — машинные коды и сырой payload. Русские подписи живут здесь: так
// формулировку можно поправить без миграции, а кодировка не участвует.

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSince } from "@/lib/warehouse/duration";
import { plural } from "@/lib/warehouse/plural";

export type WarehouseEventKind =
  | "receipt_created"
  | "receipt_counted"
  | "receipt_posted"
  | "receipt_discrepancy"
  | "receipt_corrected"
  | "task_created"
  | "task_corrected"
  | "task_shipped"
  | "task_cancelled"
  | "shipment_posted"
  | "transfer_posted"
  | "return_posted"
  | "writeoff_created"
  | "doc_reversed";

export const EVENT_LABEL: Record<WarehouseEventKind, string> = {
  receipt_created: "создана приёмка",
  receipt_counted: "пересчитана приёмка",
  receipt_posted: "приёмка на остатке",
  receipt_discrepancy: "расхождение в приёмке",
  receipt_corrected: "коррекция прихода",
  task_created: "создано задание",
  task_corrected: "изменено задание",
  task_shipped: "отгружено",
  task_cancelled: "отменено задание",
  shipment_posted: "отгружено сразу",
  transfer_posted: "перемещение",
  return_posted: "возврат с МП",
  writeoff_created: "создан брак",
  doc_reversed: "документ отменён",
};

/** Цвет метки в ленте: тревога, правка, обычная работа, готово. */
export const EVENT_TONE: Record<WarehouseEventKind, "danger" | "warn" | "info" | "ok"> = {
  receipt_created: "info",
  receipt_counted: "ok",
  receipt_posted: "ok",
  receipt_discrepancy: "danger",
  receipt_corrected: "warn",
  task_created: "info",
  task_corrected: "warn",
  task_shipped: "ok",
  task_cancelled: "warn",
  shipment_posted: "ok",
  transfer_posted: "info",
  return_posted: "info",
  writeoff_created: "danger",
  doc_reversed: "warn",
};

/** Правки — то, что попадает в «журнал изменений» (п. 6 ТЗ). */
export const CHANGE_KINDS: ReadonlySet<WarehouseEventKind> = new Set<WarehouseEventKind>([
  "receipt_corrected",
  "task_corrected",
  "task_cancelled",
  "doc_reversed",
]);

export const ALL_EVENT_KINDS = Object.keys(EVENT_LABEL) as WarehouseEventKind[];

export function isEventKind(value: unknown): value is WarehouseEventKind {
  return typeof value === "string" && value in EVENT_LABEL;
}

/** Одно изменение «было → стало»: строка (размер) и поле. */
export interface EventChange {
  /** Что именно правили: «NV-836-04 · 42». */
  line: string;
  /** received | defect | expected | qty | note — человеческую подпись даёт CHANGE_FIELD_LABEL. */
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export const CHANGE_FIELD_LABEL: Record<string, string> = {
  received: "принято",
  defect: "брак",
  expected: "ожидалось",
  qty: "кол-во",
  note: "комментарий",
};

export interface WarehouseEventRow {
  id: number;
  kind: WarehouseEventKind;
  label: string;
  refType: string | null;
  refId: string | null;
  number: string | null;
  warehouseName: string | null;
  actor: string | null;
  actorRole: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  changes: EventChange[];
}

/** Ответ GET /api/warehouse/events: лента и сводка по людям (п. 6 ТЗ). */
export interface WarehouseEventsResponse {
  rows: WarehouseEventRow[];
  byActor: {
    actor: string;
    actorRole: string | null;
    kinds: Partial<Record<WarehouseEventKind, number>>;
    total: number;
    /** Сколько из событий — правки (CHANGE_KINDS). */
    changes: number;
  }[];
  /** Все авторы за период — для фильтра. */
  actors: string[];
  truncated: boolean;
}

export interface RecordEventInput {
  legalEntityId: string;
  kind: WarehouseEventKind;
  refType?: "receipt_batch" | "stock_doc" | "product" | null;
  refId?: string | null;
  number?: string | null;
  warehouseId?: string | null;
  actor: string | null;
  actorRole?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown> | null;
  changes?: EventChange[] | null;
}

/**
 * Записать событие. Возвращает false, если не записалось (миграции нет, база
 * отказала) — и ни в коем случае не бросает: операция, к которой относится
 * событие, уже состоялась.
 */
export async function recordWarehouseEvent(db: SupabaseClient, input: RecordEventInput): Promise<boolean> {
  try {
    const { error } = await db.from("warehouse_events").insert({
      legal_entity_id: input.legalEntityId,
      kind: input.kind,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
      number: input.number ?? null,
      warehouse_id: input.warehouseId ?? null,
      actor: input.actor,
      actor_role: input.actorRole ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      payload: input.payload ?? null,
      changes: input.changes && input.changes.length > 0 ? input.changes : null,
    });
    return !error;
  } catch {
    return false;
  }
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  return raw ? raw : null;
};
const pcs = (value: number) => `${value.toLocaleString("ru-RU")} шт`;
/** «2026-04-24» → «24.04.2026»: в ленте читают глазами, а не парсером. */
const humanDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
};
const positions = (value: number) => `${value} ${plural(value, "позиция", "позиции", "позиций")}`;
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

/**
 * Подробности события одной строкой — по договорённостям о payload:
 *  receipt_created     {supplier, bagsCount, qty, lines, novelty: string[]}
 *  receipt_counted     {expected, received, defect, warehouseName, posted, createdAt}
 *  receipt_posted      {qty, total, costBasis, warehouseName}
 *  receipt_discrepancy {expected, received, short, over}
 *  receipt_corrected   {reason, deltaQty, deltaDefect, deltaAmount}
 *  task_created        {cabinetName, warehouseName, lines, qty}
 *  task_corrected      {reason}
 *  task_shipped        {cabinetName, lines, qty, plannedQty, amount, createdAt}
 *  task_cancelled      {cabinetName, qty, reason}
 *  shipment_posted     {qty, amount, lines, cabinets: string[]}
 *  transfer_posted     {qty, from, to}
 *  return_posted       {qty, defects, cabinetName, warehouseName}
 *  writeoff_created    {warehouseName, reason, qty, amount, date}
 *  doc_reversed        {kind, reversedNumber, qty, amount}
 * Отметки времени между «поставлено» и «выполнено» превращаются в «через N».
 */
export function describeEvent(row: Pick<WarehouseEventRow, "kind" | "payload" | "occurredAt" | "changes">): string {
  const p = row.payload ?? {};
  const parts: string[] = [];
  const qty = num(p.qty);
  const lines = num(p.lines);

  switch (row.kind) {
    case "receipt_created": {
      if (text(p.supplier)) parts.push(String(p.supplier));
      const bags = num(p.bagsCount);
      if (bags !== null && bags > 0) parts.push(`${bags} ${plural(bags, "мешок", "мешка", "мешков")}`);
      if (qty !== null) parts.push(pcs(qty));
      if (Array.isArray(p.novelty) && p.novelty.length > 0) parts.push(`новинка ${p.novelty.join(", ")}`);
      break;
    }
    case "receipt_counted": {
      const received = num(p.received);
      const defect = num(p.defect);
      if (received !== null) parts.push(pcs(received));
      if (defect !== null && defect > 0) parts.push(`брак ${defect}`);
      if (p.posted && text(p.warehouseName)) parts.push(`на остаток ${p.warehouseName}`);
      const since = formatSince(text(p.createdAt), row.occurredAt);
      if (since) parts.push(`${since} после создания`);
      break;
    }
    case "receipt_posted": {
      if (qty !== null) parts.push(pcs(qty));
      const total = num(p.total);
      if (total !== null && total > 0) parts.push(money(total));
      if (p.costBasis === "estimated") parts.push("себестоимость расчётная");
      if (text(p.warehouseName)) parts.push(String(p.warehouseName));
      break;
    }
    case "receipt_discrepancy": {
      const expected = num(p.expected);
      const received = num(p.received);
      if (expected !== null && received !== null) parts.push(`ждали ${expected}, принято ${received}`);
      const short = num(p.short);
      const over = num(p.over);
      if (short) parts.push(`недовоз ${short}`);
      if (over) parts.push(`излишек ${over}`);
      break;
    }
    case "receipt_corrected": {
      const deltaQty = num(p.deltaQty);
      const deltaDefect = num(p.deltaDefect);
      if (deltaQty) parts.push(`принято ${deltaQty > 0 ? "+" : ""}${deltaQty}`);
      if (deltaDefect) parts.push(`брак ${deltaDefect > 0 ? "+" : ""}${deltaDefect}`);
      if (text(p.reason)) parts.push(`причина: ${p.reason}`);
      break;
    }
    case "task_created": {
      if (text(p.cabinetName)) parts.push(String(p.cabinetName));
      if (lines !== null) parts.push(positions(lines));
      if (qty !== null) parts.push(pcs(qty));
      break;
    }
    case "task_corrected": {
      if (text(p.reason)) parts.push(String(p.reason));
      break;
    }
    case "task_shipped": {
      if (text(p.cabinetName)) parts.push(String(p.cabinetName));
      if (lines !== null) parts.push(positions(lines));
      if (qty !== null) {
        const planned = num(p.plannedQty);
        parts.push(planned !== null && planned !== qty ? `${pcs(qty)} из ${planned} в задании` : pcs(qty));
      }
      const since = formatSince(text(p.createdAt), row.occurredAt);
      if (since) parts.push(`${since} после постановки`);
      break;
    }
    case "task_cancelled": {
      if (text(p.cabinetName)) parts.push(String(p.cabinetName));
      if (qty !== null) parts.push(pcs(qty));
      if (text(p.reason)) parts.push(`«${p.reason}»`);
      break;
    }
    case "shipment_posted": {
      if (Array.isArray(p.cabinets) && p.cabinets.length > 0) parts.push(p.cabinets.join(", "));
      if (lines !== null) parts.push(positions(lines));
      if (qty !== null) parts.push(pcs(qty));
      break;
    }
    case "transfer_posted": {
      if (text(p.from) && text(p.to)) parts.push(`${p.from} → ${p.to}`);
      if (qty !== null) parts.push(pcs(qty));
      break;
    }
    case "return_posted": {
      if (text(p.cabinetName)) parts.push(`из ${p.cabinetName}`);
      if (qty !== null) parts.push(pcs(qty));
      const defects = num(p.defects);
      if (defects) parts.push(`брак ${defects}`);
      break;
    }
    case "writeoff_created": {
      if (text(p.warehouseName)) parts.push(String(p.warehouseName));
      if (qty !== null) parts.push(pcs(qty));
      if (text(p.reason)) parts.push(String(p.reason));
      if (text(p.date)) parts.push(`дата ${humanDate(String(p.date))}`);
      break;
    }
    case "doc_reversed": {
      if (text(p.reversedNumber)) parts.push(`отменяет ${p.reversedNumber}`);
      if (qty !== null) parts.push(`${pcs(qty)} вернулись в остаток`);
      break;
    }
  }
  return parts.join(" · ");
}

/** Правка словами: «42: принято 33 → 35». */
export function describeChange(change: EventChange): string {
  const field = CHANGE_FIELD_LABEL[change.field] ?? change.field;
  const before = change.before === null || change.before === "" ? "—" : String(change.before);
  const after = change.after === null || change.after === "" ? "—" : String(change.after);
  return `${change.line}: ${field} ${before} → ${after}`;
}

export function toEventRow(raw: Record<string, unknown>, warehouseNames: Map<string, string>): WarehouseEventRow {
  const kind = isEventKind(raw.kind) ? raw.kind : "receipt_created";
  const changes = Array.isArray(raw.changes)
    ? (raw.changes as unknown[]).filter((item): item is EventChange => typeof item === "object" && item !== null && "field" in item)
    : [];
  return {
    id: Number(raw.id),
    kind,
    label: isEventKind(raw.kind) ? EVENT_LABEL[kind] : String(raw.kind),
    refType: raw.ref_type ? String(raw.ref_type) : null,
    refId: raw.ref_id ? String(raw.ref_id) : null,
    number: raw.number ? String(raw.number) : null,
    warehouseName: raw.warehouse_id ? warehouseNames.get(String(raw.warehouse_id)) ?? null : null,
    actor: raw.actor ? String(raw.actor) : null,
    actorRole: raw.actor_role ? String(raw.actor_role) : null,
    occurredAt: String(raw.occurred_at),
    payload: typeof raw.payload === "object" && raw.payload !== null ? (raw.payload as Record<string, unknown>) : {},
    changes,
  };
}
