export interface PendingTelegramPayment {
  id: string;
  reasons?: unknown;
}

const messageIds = (item: PendingTelegramPayment) => Array.isArray(item.reasons)
  ? item.reasons.map(String)
    .filter((reason) => reason.startsWith("__telegram_message_id:"))
    .map((reason) => Number(reason.slice("__telegram_message_id:".length)))
    .filter(Number.isFinite)
  : [];

export function selectPendingTelegramPayment<T extends PendingTelegramPayment>(items: T[], replyMessageId?: number): T | null {
  if (replyMessageId) {
    const exact = items.filter((item) => messageIds(item).includes(replyMessageId));
    if (exact.length === 1) return exact[0];
    return items.length === 1 ? items[0] : null;
  }
  if (items.length === 1) return items[0];
  const ranked = items.map((item) => ({ item, messageId: Math.max(...messageIds(item), -1) }))
    .filter(({ messageId }) => messageId > 0)
    .sort((left, right) => right.messageId - left.messageId);
  if (!ranked.length || ranked[0].messageId === ranked[1]?.messageId) return null;
  return ranked[0].item;
}
