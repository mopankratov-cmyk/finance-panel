export interface MarketplaceCashAmountInput {
  marketplace: "wb" | "ozon";
  amount: number | null;
  availableAmount: number | null;
  calculationMethod: string;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * В прямом балансе WB `current` и `for_withdraw` — две отдельные части денег
 * продавца. Для общих seller-кабинетов сумма уже рассчитана по нашим брендам,
 * а availableAmount является подмножеством этой расчётной суммы.
 */
export function marketplaceCashAmount(input: MarketplaceCashAmountInput): number | null {
  if (input.amount === null || !Number.isFinite(input.amount)) return null;
  if (input.marketplace === "wb" && input.calculationMethod === "provider_balance") {
    const available = input.availableAmount !== null && Number.isFinite(input.availableAmount)
      ? input.availableAmount
      : 0;
    return round2(input.amount + available);
  }
  return round2(input.amount);
}

export function isLateDirectWbSnapshot(input: {
  marketplace: "wb" | "ozon";
  calculationMethod: string;
  snapshotMonth: string;
  capturedAt: string;
}): boolean {
  if (input.marketplace !== "wb" || input.calculationMethod !== "provider_balance") return false;
  const captured = new Date(input.capturedAt);
  if (!Number.isFinite(captured.getTime())) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(captured).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return date !== input.snapshotMonth || minute > 20;
}
