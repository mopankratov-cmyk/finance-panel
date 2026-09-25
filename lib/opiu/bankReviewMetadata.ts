export const BANK_PAYMENT_COMMENT_MARKER = "__payment_comment:";

export function paymentCommentFromReasons(reasons: unknown): string {
  if (!Array.isArray(reasons)) return "";
  return reasons.map(String).find((reason) => reason.startsWith(BANK_PAYMENT_COMMENT_MARKER))
    ?.slice(BANK_PAYMENT_COMMENT_MARKER.length).trim() ?? "";
}

export function withPaymentComment(reasons: unknown, comment: string): string[] {
  const current = Array.isArray(reasons) ? reasons.map(String) : [];
  const withoutComment = current.filter((reason) => !reason.startsWith(BANK_PAYMENT_COMMENT_MARKER));
  const value = comment.trim().slice(0, 2_000);
  return value ? [...withoutComment, `${BANK_PAYMENT_COMMENT_MARKER}${value}`] : withoutComment;
}
