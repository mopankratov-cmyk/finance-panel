import {
  subjectAnnualSeasonality,
  subjectForecastDaily,
  type SubjectAnnualSeasonality,
  type SubjectForecastDay,
} from "@/lib/mpstats/client";

export type MpstatsSeasonalitySource =
  | "mpstats-forecast"
  | "mpstats-annual"
  | "current-period"
  | "unavailable";

export interface MpstatsSeasonalityResult {
  factor: number;
  rawFactor: number;
  source: MpstatsSeasonalitySource;
  subjectId: number | null;
  subjectName: string;
  cap: number;
  note: string;
}

interface CalculateSeasonalityInput {
  subjectId: number;
  subjectName: string;
  targetYear: number;
  targetMonth: number;
  currentDate: string;
  forecast?: SubjectForecastDay[];
  annual?: SubjectAnnualSeasonality[];
}

const roundFactor = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const average = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

export function normalizedSubjectName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}

// Основные предметы Optima закрепляем явно: это экономит вызов item/full и
// сохраняет расчёт даже при временной недоступности карточки в MPSTATS.
export function knownMpstatsSubjectId(subjectName: string): number | null {
  const subject = normalizedSubjectName(subjectName);
  if (/ветров/.test(subject)) return 172;
  if (/куртк/.test(subject)) return 168;
  if (/пенал/.test(subject)) return 311;
  return null;
}

export function mpstatsSeasonalityCap(subjectId: number, subjectName: string) {
  return subjectId === 311 || /пенал/.test(normalizedSubjectName(subjectName)) ? 3 : 2.5;
}

export function moscowCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function unavailableMpstatsSeasonality(
  subjectName: string,
  subjectId: number | null,
  note = "Для предмета нет рыночного коэффициента MPSTATS",
): MpstatsSeasonalityResult {
  return {
    factor: 1,
    rawFactor: 1,
    source: "unavailable",
    subjectId,
    subjectName,
    cap: subjectId ? mpstatsSeasonalityCap(subjectId, subjectName) : 2.5,
    note,
  };
}

export function calculateMpstatsSeasonality(input: CalculateSeasonalityInput): MpstatsSeasonalityResult {
  const month = String(input.targetMonth).padStart(2, "0");
  const targetKey = `${input.targetYear}-${month}`;
  const currentKey = input.currentDate.slice(0, 7);
  const cap = mpstatsSeasonalityCap(input.subjectId, input.subjectName);

  // Последние 7 дней уже находятся в сезоне текущего месяца. Повторно
  // умножать их на июльский/августовский индекс означало бы учесть сезон дважды.
  if (targetKey <= currentKey) {
    return {
      factor: 1,
      rawFactor: 1,
      source: "current-period",
      subjectId: input.subjectId,
      subjectName: input.subjectName,
      cap,
      note: "Текущий или прошлый месяц: сезон уже учтён в факте за 7 дней",
    };
  }

  const forecast = input.forecast ?? [];
  const recentActual = forecast
    .filter((row) => String(row.date ?? "") < input.currentDate && finite(row.real_sales) > 0)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 7)
    .map((row) => finite(row.real_sales));
  const targetForecast = forecast
    .filter((row) => String(row.date ?? "").startsWith(`${targetKey}-`) && finite(row.yhat_sales) > 0)
    .map((row) => finite(row.yhat_sales));
  const recentAverage = average(recentActual);
  const targetAverage = average(targetForecast);

  let rawFactor = recentAverage > 0 && targetAverage > 0 ? targetAverage / recentAverage : 0;
  let source: MpstatsSeasonalitySource = "mpstats-forecast";

  if (!(rawFactor > 0)) {
    const currentMonth = input.currentDate.slice(5, 7);
    const annual = input.annual ?? [];
    const currentEffect = annual.find((row) => String(row.date ?? "").startsWith(`${currentMonth}-`));
    const targetEffect = annual.find((row) => String(row.date ?? "").startsWith(`${month}-`));
    const currentIndex = 1 + finite(currentEffect?.season_sales) / 100;
    const targetIndex = 1 + finite(targetEffect?.season_sales) / 100;
    rawFactor = currentIndex > 0.05 && targetIndex > 0.05 ? targetIndex / currentIndex : 0;
    source = "mpstats-annual";
  }

  if (!(rawFactor > 0) || !Number.isFinite(rawFactor)) {
    return unavailableMpstatsSeasonality(input.subjectName, input.subjectId);
  }

  const applied = Math.min(cap, Math.max(0.6, rawFactor));
  const rawRounded = roundFactor(rawFactor);
  const factor = roundFactor(applied);
  const sourceLabel = source === "mpstats-forecast" ? "дневной прогноз" : "годовой профиль";
  const capped = rawFactor > cap
    ? `; рыночный пик ограничен безопасным пределом ${cap.toLocaleString("ru-RU")}×`
    : rawFactor < 0.6
      ? "; снижение ограничено безопасным пределом 0,6×"
      : "";

  return {
    factor,
    rawFactor: rawRounded,
    source,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    cap,
    note: `MPSTATS: ${sourceLabel}, рынок ${rawRounded.toLocaleString("ru-RU")}×${capped}`,
  };
}

export async function loadMpstatsSeasonality(input: Omit<CalculateSeasonalityInput, "forecast" | "annual">) {
  const currentKey = input.currentDate.slice(0, 7);
  const targetKey = `${input.targetYear}-${String(input.targetMonth).padStart(2, "0")}`;
  if (targetKey <= currentKey) return calculateMpstatsSeasonality(input);

  const [forecast, annual] = await Promise.all([
    subjectForecastDaily(input.subjectId),
    subjectAnnualSeasonality(input.subjectId),
  ]);
  return calculateMpstatsSeasonality({ ...input, forecast, annual });
}
