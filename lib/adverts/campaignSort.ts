export interface AdvertCampaignSortInput {
  enabled?: boolean | null;
  spend_today?: number | null;
  spent_14?: number | null;
  drr?: number | null;
  name?: string | null;
  id?: number | null;
}

const num = (value: number | null | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function compareAdvertCampaigns(a: AdvertCampaignSortInput, b: AdvertCampaignSortInput): number {
  const activeDelta = Number(Boolean(b.enabled)) - Number(Boolean(a.enabled));
  if (activeDelta !== 0) return activeDelta;

  const todayDelta = num(b.spend_today) - num(a.spend_today);
  if (todayDelta !== 0) return todayDelta;

  const periodDelta = num(b.spent_14) - num(a.spent_14);
  if (periodDelta !== 0) return periodDelta;

  const drrA = a.drr == null ? Number.POSITIVE_INFINITY : num(a.drr);
  const drrB = b.drr == null ? Number.POSITIVE_INFINITY : num(b.drr);
  const drrDelta = drrA - drrB;
  if (drrDelta !== 0) return drrDelta;

  const nameDelta = String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru");
  if (nameDelta !== 0) return nameDelta;

  return num(a.id) - num(b.id);
}
