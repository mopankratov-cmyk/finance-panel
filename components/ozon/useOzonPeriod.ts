"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ozonRangeFor,
  resolveOzonPeriod,
  type OzonPeriodPreset,
} from "@/lib/ozon/period";

const STORAGE_KEY = "ozon:period";

interface StoredPeriod {
  from: string;
  to: string;
  preset: OzonPeriodPreset;
}

/**
 * Выбранный период кокпита — общий для всех его экранов.
 *
 * Хранится в localStorage: человек выбирает неделю распродажи в «Продажах», а
 * потом идёт в «Экономику» смотреть ту же неделю. Сбрасывать выбор на каждом
 * переходе значило бы заставлять его выбирать заново семь раз подряд.
 */
export function useOzonPeriod(defaultPreset: OzonPeriodPreset = "two_weeks") {
  const [state, setState] = useState<StoredPeriod>(() => {
    const fallback = { ...ozonRangeFor(defaultPreset), preset: defaultPreset };
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<StoredPeriod>;
      if (!parsed.from || !parsed.to) return fallback;
      // Скользящий пресет пересчитывается от СЕГОДНЯ. Раньше «последние две
      // недели», выбранные неделю назад, замораживались теми датами: период
      // не двигался с календарём, а каждый экран собирался холодным — даты
      // никогда не совпадали с прогретым снимком «14 дней до сегодня».
      const preset = parsed.preset ?? "custom";
      if (preset !== "custom") {
        const rolled = ozonRangeFor(preset as OzonPeriodPreset);
        return { from: rolled.from, to: rolled.to, preset };
      }
      const period = resolveOzonPeriod(parsed.from, parsed.to);
      return { from: period.from, to: period.to, preset };
    } catch {
      return fallback;
    }
  });

  const remember = useCallback((next: StoredPeriod) => {
    setState(next);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* приватный режим — не беда */ }
    }
  }, []);

  const applyPreset = useCallback((value: string) => {
    const preset = value as OzonPeriodPreset;
    remember({ ...ozonRangeFor(preset), preset });
  }, [remember]);

  const applyRange = useCallback((from: string, to: string) => {
    const period = resolveOzonPeriod(from, to);
    remember({ from: period.from, to: period.to, preset: "custom" });
  }, [remember]);

  const period = useMemo(() => resolveOzonPeriod(state.from, state.to), [state.from, state.to]);

  return { period, preset: state.preset, applyPreset, applyRange };
}
