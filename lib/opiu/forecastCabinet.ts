// §3. Прогноз WB считается строго по одному кабинету. Здесь — чистая логика
// выбора кабинета для запроса прогноза: валидация запрошенного кабинета против
// списка доступных и детерминированный дефолт. Смешивание кабинетов запрещено (§19).

export interface WbForecastCabinet {
  id: string;
  name: string;
}

export type WbForecastCabinetResolution =
  | { ok: true; cabinetId: string; cabinetName: string }
  | { ok: false; status: 404 | 422; error: string };

function normalizeId(value: string | null | undefined) {
  return String(value ?? "").trim();
}

/**
 * Выбирает кабинет для расчёта прогноза WB.
 * - requested задан → должен присутствовать в списке доступных, иначе 404;
 * - requested не задан → defaultId, если он доступен, иначе первый доступный;
 * - пустой список доступных кабинетов → 422.
 * "all"/групповые агрегаты запрещены — прогноз считается по одному кабинету.
 */
export function resolveForecastCabinet(
  cabinets: WbForecastCabinet[],
  requested: string | null | undefined,
  defaultId: string,
): WbForecastCabinetResolution {
  const available = cabinets
    .map((cabinet) => ({ id: normalizeId(cabinet.id), name: String(cabinet.name ?? "").trim() }))
    .filter((cabinet) => cabinet.id);
  if (available.length === 0) {
    return { ok: false, status: 422, error: "Нет доступных кабинетов WB для прогноза" };
  }

  const requestedId = normalizeId(requested);
  if (requestedId === "all" || requestedId.startsWith("group:")) {
    return { ok: false, status: 422, error: "Для финансового прогноза выберите один кабинет WB" };
  }

  if (requestedId) {
    const match = available.find((cabinet) => cabinet.id === requestedId);
    if (!match) {
      return { ok: false, status: 404, error: "Выбранный кабинет WB не найден или недоступен" };
    }
    return { ok: true, cabinetId: match.id, cabinetName: match.name };
  }

  const preferred = available.find((cabinet) => cabinet.id === normalizeId(defaultId)) ?? available[0];
  return { ok: true, cabinetId: preferred.id, cabinetName: preferred.name };
}
