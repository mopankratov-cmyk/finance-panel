export function isWbGlobalRateLimit(status: number, body: string): boolean {
  if (status !== 429) return false;
  return /too many requests/i.test(body) || /Limited by global limiter/i.test(body) || body.trim().length === 0;
}

export function isWbGlobalRateLimitMessage(message: string | null | undefined): boolean {
  const body = String(message ?? "");
  return /\b429\b/.test(body) && isWbGlobalRateLimit(429, body);
}
