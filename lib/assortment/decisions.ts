/**
 * Решения по модели: действия, статусы и причины отказа. Чистые функции.
 *
 * Каждое решение — новая версия в assortment_decisions, старые не
 * переписываются (ТЗ §9). Причина отказа обязательна: по ней дальше учимся,
 * что не показывать (улучшение 7 от 01.10).
 */

export type ReferenceStatus = "new" | "watching" | "in_collection" | "selected" | "sample_needed" | "rejected" | "archived";
export type DecisionKind = "to_collection" | "selected" | "sample_needed" | "postponed" | "rejected" | "archived";
export type ActionId = "selected" | "sample_needed" | "postponed" | "rejected" | "archived" | "restore";

export const STATUS_LABEL: Record<ReferenceStatus, string> = {
  new: "Новая находка",
  watching: "Наблюдаем",
  in_collection: "В подборке",
  selected: "Отобрана",
  sample_needed: "Нужен образец",
  rejected: "Отклонена",
  archived: "Скрыта",
};

export const DECISION_LABEL: Record<DecisionKind, string> = {
  to_collection: "В подборку",
  selected: "Отобрана",
  sample_needed: "Нужен образец",
  postponed: "Отложена",
  rejected: "Отклонена",
  archived: "Скрыта",
};

interface ActionSpec {
  label: string;
  decision: DecisionKind;
  status: ReferenceStatus;
  needsReason?: boolean;
}

export const ACTIONS: Record<ActionId, ActionSpec> = {
  selected: { label: "Отобрать", decision: "selected", status: "selected" },
  sample_needed: { label: "Нужен образец", decision: "sample_needed", status: "sample_needed" },
  postponed: { label: "Отложить", decision: "postponed", status: "watching" },
  rejected: { label: "Отклонить", decision: "rejected", status: "rejected", needsReason: true },
  archived: { label: "Скрыть", decision: "archived", status: "archived" },
  // Возврат в ленту — тоже решение, но отдельного вида в схеме для него нет:
  // пишем «отложена» с пометкой, статус — «наблюдаем».
  restore: { label: "Вернуть в ленту", decision: "postponed", status: "watching" },
};

export function isReferenceStatus(value: unknown): value is ReferenceStatus {
  return typeof value === "string" && value in STATUS_LABEL;
}

export function isActionId(value: unknown): value is ActionId {
  return typeof value === "string" && value in ACTIONS;
}

/** Какие действия показывать: недоступные не рисуем вовсе. */
export function availableActions(status: ReferenceStatus): ActionId[] {
  switch (status) {
    case "new":
      return ["selected", "sample_needed", "postponed", "rejected", "archived"];
    case "watching":
      return ["selected", "sample_needed", "rejected", "archived"];
    case "in_collection":
      return ["sample_needed", "rejected"];
    case "selected":
      return ["sample_needed", "postponed", "rejected"];
    case "sample_needed":
      return ["selected", "postponed", "rejected"];
    case "rejected":
    case "archived":
      return ["restore"];
  }
}

/** Причины отказа — те же, что у замены кандидата в подборке (ТЗ §8), плюс «другое». */
export const REJECT_REASONS = {
  repeats_assortment: "Повторяет наш ассортимент",
  shape: "Не нравится форма",
  audience: "Не наша аудитория",
  weak_evidence: "Слабые подтверждения",
  other: "Другое",
} as const;

export type RejectReason = keyof typeof REJECT_REASONS;

export class DecisionInputError extends Error {}

/** Причина в том виде, как её пишем в assortment_decisions.reason. */
export function decisionReason(action: ActionId, reason: unknown, comment: unknown): string | null {
  const text = typeof comment === "string" ? comment.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (action === "restore") return "возвращена в ленту";
  if (!ACTIONS[action].needsReason) return text || null;
  if (typeof reason !== "string" || !(reason in REJECT_REASONS)) throw new DecisionInputError("Укажите причину отказа.");
  if (reason === "other") {
    if (!text) throw new DecisionInputError("Для «Другое» напишите причину словами.");
    return `other:${text}`;
  }
  return text ? `${reason}:${text}` : reason;
}

export function reasonLabel(stored: string | null): string | null {
  if (!stored) return null;
  const [key, ...rest] = stored.split(":");
  const comment = rest.join(":").trim();
  if (key in REJECT_REASONS) {
    const label = REJECT_REASONS[key as RejectReason];
    if (key === "other") return comment || label;
    return comment ? `${label} — ${comment}` : label;
  }
  return stored;
}
