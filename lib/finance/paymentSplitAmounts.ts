export function splitEvenly(total: number, count: number): number[] {
  if (!Number.isFinite(total) || total < 0 || !Number.isInteger(count) || count < 1) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => (base + (i < cents % count ? 1 : 0)) / 100);
}

export function balanceLast<T extends { amount: number }>(parts: T[], total: number): T[] {
  if (!parts.length) return parts;
  const used = parts.slice(0, -1).reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
  return parts.map((p, i) => i === parts.length - 1 ? { ...p, amount: (Math.round(total * 100) - used) / 100 } : p);
}
