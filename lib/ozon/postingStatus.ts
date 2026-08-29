/**
 * Статусы отправлений Ozon — точной картой, а не поиском подстроки.
 *
 * Раньше «доставлено» определялось как `status.includes("deliver")`, и в него
 * попадали `awaiting_deliver` (сборка готова, ждёт передачи в доставку) и
 * `delivering` (едет к покупателю). Отправление, которое горит и требует
 * отгрузки СЕГОДНЯ, показывалось зелёным «Доставлен», а счётчик «Просрочено»
 * его не видел вовсе — менеджер узнавал о срыве отгрузки от Ozon, а не от нас.
 *
 * Неизвестный статус НИКОГДА не считается доставленным: незнакомое имя
 * остаётся «в работе» и показывается как есть. Ошибиться в сторону «ещё в
 * работе» безопасно, в сторону «уже доставлено» — нет.
 */

/** Что происходит с отправлением с точки зрения работы менеджера. */
export type OzonPostingStage =
  /** Ждёт действий продавца: собрать, отгрузить, подтвердить. */
  | "shipping"
  /** Передано в доставку и едет. */
  | "transit"
  /** Доехало до покупателя. */
  | "delivered"
  /** Отменено или не принято. */
  | "cancelled"
  /** Спор, арбитраж — требует разбирательства. */
  | "problem"
  /** Статус нам незнаком: показываем как есть и считаем активным. */
  | "unknown";

interface StatusMeta {
  label: string;
  stage: OzonPostingStage;
}

const STATUSES: Record<string, StatusMeta> = {
  // Ждут продавца
  awaiting_registration: { label: "Ожидает регистрации", stage: "shipping" },
  acceptance_in_progress: { label: "Идёт приёмка", stage: "shipping" },
  awaiting_approve: { label: "Ожидает подтверждения", stage: "shipping" },
  awaiting_verification: { label: "Ожидает проверки", stage: "shipping" },
  awaiting_packaging: { label: "Ожидает сборки", stage: "shipping" },
  awaiting_deliver: { label: "Ожидает отгрузки", stage: "shipping" },
  // В пути
  sent_by_seller: { label: "Отправлен продавцом", stage: "transit" },
  driver_pickup: { label: "У водителя", stage: "transit" },
  delivering: { label: "В пути", stage: "transit" },
  // Доехало
  delivered: { label: "Доставлен", stage: "delivered" },
  completed: { label: "Завершён", stage: "delivered" },
  // Не состоялось
  cancelled: { label: "Отменён", stage: "cancelled" },
  cancelled_from_split_pending: { label: "Отменён при разделении", stage: "cancelled" },
  not_accepted: { label: "Не принят на сортировке", stage: "cancelled" },
  // Разбирательство
  arbitration: { label: "Арбитраж", stage: "problem" },
  client_arbitration: { label: "Клиентский арбитраж", stage: "problem" },
};

export interface OzonPostingState {
  /** Человеческая подпись статуса для интерфейса. */
  label: string;
  stage: OzonPostingStage;
  delivered: boolean;
  cancelled: boolean;
  /** Ждёт отгрузки продавцом — то, что менеджер обязан сделать руками. */
  awaitingShipment: boolean;
}

export function describeOzonPostingStatus(rawStatus: unknown): OzonPostingState {
  const status = String(rawStatus ?? "").trim().toLowerCase();
  const meta = STATUSES[status];
  const stage = meta?.stage ?? "unknown";
  return {
    label: meta?.label ?? (status ? status : "Без статуса"),
    stage,
    delivered: stage === "delivered",
    cancelled: stage === "cancelled",
    awaitingShipment: status === "awaiting_deliver" || status === "awaiting_packaging",
  };
}

/**
 * Просрочка считается только по тому, что ещё зависит от нас: доехавшее,
 * отменённое и уже переданное в доставку просрочить нельзя.
 */
export function isOzonPostingDelayed(
  state: OzonPostingState,
  shipmentDate: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!shipmentDate) return false;
  if (state.delivered || state.cancelled || state.stage === "transit") return false;
  const planned = new Date(shipmentDate).getTime();
  return Number.isFinite(planned) && planned < now;
}
