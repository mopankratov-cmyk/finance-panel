"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Прочитать период из адреса: `?preset=month` или `?from=…&to=…`. */
function periodFromUrl(): StoredPeriod | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const preset = params.get("preset");
  const from = params.get("from");
  const to = params.get("to");
  if (preset && preset !== "custom") {
    const rolled = ozonRangeFor(preset as OzonPeriodPreset);
    return { from: rolled.from, to: rolled.to, preset: preset as OzonPeriodPreset };
  }
  if (from && to) {
    const period = resolveOzonPeriod(from, to);
    return { from: period.from, to: period.to, preset: "custom" };
  }
  return null;
}

/**
 * Выбранный период кокпита — общий для всех его экранов.
 *
 * Живёт в адресе и в localStorage. Адрес — чтобы срез можно было передать
 * ссылкой («посмотри вот это»), раньше он существовал только в памяти
 * браузера и повторить его у коллеги было нечем. localStorage — чтобы человек
 * не выбирал период заново на каждом из семи экранов.
 */
export function useOzonPeriod(defaultPreset: OzonPeriodPreset = "two_weeks") {
  const [state, setState] = useState<StoredPeriod>(() => {
    const fallback = { ...ozonRangeFor(defaultPreset), preset: defaultPreset };
    if (typeof window === "undefined") return fallback;
    // Адрес важнее памяти браузера: по ссылке человек ждёт именно тот срез,
    // который ему прислали.
    const fromUrl = periodFromUrl();
    if (fromUrl) return fromUrl;
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

  // Вкладка может жить сутками. Скользящий пресет считался один раз при
  // открытии, поэтому после полуночи «2 недели» продолжали кончаться вчера:
  // экран показывал вчерашний срез и промахивался мимо прогретого снимка.
  useEffect(() => {
    if (state.preset === "custom") return;
    const check = () => {
      const rolled = ozonRangeFor(state.preset);
      if (rolled.from !== state.from || rolled.to !== state.to) {
        setState({ from: rolled.from, to: rolled.to, preset: state.preset });
      }
    };
    const timer = setInterval(check, 60_000);
    // Возврат к вкладке — самый частый момент, когда дата уже сменилась.
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [state.from, state.preset, state.to]);

  // Адрес держим в актуальном состоянии без перезагрузки страницы: это ссылка
  // на срез, а не навигация.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (state.preset === "custom") {
      params.delete("preset");
      params.set("from", state.from);
      params.set("to", state.to);
    } else {
      params.set("preset", state.preset);
      params.delete("from");
      params.delete("to");
    }
    const next = `${window.location.pathname}?${params.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [state]);

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
