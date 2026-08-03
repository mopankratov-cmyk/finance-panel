export interface SeasonalProductRule {
  article: string;
  weather_mode: "hot" | "cold" | "rain" | "snow";
  threshold: number;
  impact_percent_per_unit: number;
  max_adjustment_percent: number;
}

export interface WeatherImpact {
  article: string;
  adjustmentPercent: number;
  reason: string;
}

export interface ArticleOrderRegion {
  article: string;
  region: string;
  share: number;
}

interface ForecastDaily {
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
  snowfall_sum?: number[];
}

const average = (values: number[] | undefined) =>
  values?.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;

function requestSignal(parent?: AbortSignal) {
  const timeout = AbortSignal.timeout(5_000);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function coordinates(region: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ name: region, count: "1", language: "ru", countryCode: "RU" });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    next: { revalidate: 604_800 },
    signal: requestSignal(signal),
  });
  if (!response.ok) return null;
  const body = await response.json() as { results?: { latitude: number; longitude: number; name: string }[] };
  return body.results?.[0] ?? null;
}

async function forecastForRegion(region: string, signal?: AbortSignal) {
  try {
    const location = await coordinates(region, signal);
    if (!location) return null;
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum",
      timezone: "auto",
      forecast_days: "16",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      next: { revalidate: 21_600 },
      signal: requestSignal(signal),
    });
    if (!response.ok) return null;
    const data = await response.json() as { daily?: ForecastDaily };
    return data.daily ?? {};
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return null;
  }
}

export async function calculateWeatherImpacts(
  rules: SeasonalProductRule[],
  orderRegions: ArticleOrderRegion[],
  signal?: AbortSignal,
): Promise<Map<string, WeatherImpact>> {
  const result = new Map<string, WeatherImpact>();
  const forecasts = new Map<string, Promise<ForecastDaily | null>>();
  const loadForecast = (region: string) => {
    const cached = forecasts.get(region);
    if (cached) return cached;
    const pending = forecastForRegion(region, signal);
    forecasts.set(region, pending);
    return pending;
  };
  await Promise.all(rules.map(async (rule) => {
    signal?.throwIfAborted();
    const article = rule.article.trim().toUpperCase();
    const relevantRegions = orderRegions.filter((item) => item.article === article && item.share >= 0.05);
    if (!relevantRegions.length) return;
    let weightedAdjustment = 0;
    const reasons: string[] = [];
    await Promise.all(relevantRegions.map(async ({ region, share }) => {
    const daily = await loadForecast(region);
    if (!daily) return;
    let units = 0;
    let metric = "";
    if (rule.weather_mode === "hot") {
      const value = average(daily.temperature_2m_max);
      units = Math.max(0, value - rule.threshold);
      metric = `средняя максимальная температура ${value.toFixed(1)} °C`;
    } else if (rule.weather_mode === "cold") {
      const value = average(daily.temperature_2m_min);
      units = Math.max(0, rule.threshold - value);
      metric = `средняя минимальная температура ${value.toFixed(1)} °C`;
    } else if (rule.weather_mode === "rain") {
      const value = average(daily.precipitation_sum);
      units = Math.max(0, value - rule.threshold);
      metric = `осадки ${value.toFixed(1)} мм/день`;
    } else {
      const value = average(daily.snowfall_sum);
      units = Math.max(0, value - rule.threshold);
      metric = `снег ${value.toFixed(1)} см/день`;
    }
    const regionalAdjustment = Math.min(rule.max_adjustment_percent, units * rule.impact_percent_per_unit);
    weightedAdjustment += regionalAdjustment * share;
    if (regionalAdjustment > 0) reasons.push(`${region} (${Math.round(share * 100)}% заказов): ${metric}`);
    }));
    const adjustmentPercent = Math.min(rule.max_adjustment_percent, weightedAdjustment);
    if (adjustmentPercent > 0) result.set(article, {
      article,
      adjustmentPercent,
      reason: reasons.join("; "),
    });
  }));
  return result;
}
