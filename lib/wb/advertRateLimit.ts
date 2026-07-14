export function isWbAdvertRateLimit(status: number, body: string): boolean {
  if (status !== 429) return false;
  return /too many requests/i.test(body) || /Limited by global limiter/i.test(body) || body.trim().length === 0;
}
