"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface WbCabinet {
  id: string;
  name: string;
  marketplace: string;
  trade_mark?: string | null;
  seller_id?: string | null;
  inn?: string | null;
  is_active?: boolean;
  token_mask?: string;
  has_advert?: boolean;
  has_content?: boolean;
  has_feedbacks?: boolean;
}

interface SessionUser {
  email: string;
  role: "director" | "finance" | "manager";
  cabinet_ids: string[];
}

interface WbCabinetContextValue {
  cabinets: WbCabinet[];
  cabinetId: string;
  activeCabinet: WbCabinet | null;
  user: SessionUser | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  canUseAll: boolean;
  canWrite: boolean;
  setCabinetId: (cabinetId: string) => void;
  refreshCabinets: () => void;
}

const WbCabinetContext = createContext<WbCabinetContextValue | null>(null);
const STORAGE_KEY = "fp_cab_wb";

export function WbCabinetProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCabinet = searchParams.get("cabinet");
  const [cabinets, setCabinets] = useState<WbCabinet[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [cabinetId, setCabinetIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingCabinet = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      fetch("/api/cabinets?accessible=1", {
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body as { cabinets?: WbCabinet[] };
      }),
      fetch("/api/auth/me", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => response.json() as Promise<{ user?: SessionUser | null }>),
    ])
      .then(([cabinetResponse, meResponse]) => {
        const wbCabinets = (cabinetResponse.cabinets ?? []).filter(
          (cabinet) => cabinet.marketplace === "wb" && cabinet.is_active !== false,
        );
        setCabinets(wbCabinets);
        setUser(meResponse.user ?? null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить кабинеты");
        setCabinets([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [refreshKey]);

  const canUseAll = !(
    user?.role === "manager" && Array.isArray(user.cabinet_ids) && user.cabinet_ids.length > 0
  );

  const isAllowed = useCallback(
    (candidate: string | null | undefined) => {
      if (!candidate) return false;
      if (candidate === "all") return canUseAll && cabinets.length > 1;
      return cabinets.some((cabinet) => cabinet.id === candidate);
    },
    [cabinets, canUseAll],
  );

  const replaceCabinetInUrl = useCallback(
    (nextCabinetId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("cabinet", nextCabinetId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const remember = useCallback((nextCabinetId: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, nextCabinetId);
    } catch {
      // localStorage может быть выключен политикой браузера — URL всё равно сохранит контекст.
    }
  }, []);

  useEffect(() => {
    if (loading) return;

    if (pendingCabinet.current && requestedCabinet !== pendingCabinet.current) return;
    if (pendingCabinet.current === requestedCabinet) pendingCabinet.current = null;

    let stored = "";
    try {
      stored = localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      // Используем URL/первый доступный кабинет.
    }

    const fallback = cabinets[0]?.id ?? "all";
    const next = isAllowed(requestedCabinet)
      ? requestedCabinet!
      : isAllowed(cabinetId)
        ? cabinetId
        : isAllowed(stored)
          ? stored
          : fallback;

    if (next !== cabinetId) {
      setCabinetIdState(next);
      remember(next);
    }
    if (requestedCabinet !== next) replaceCabinetInUrl(next);
    setReady(true);
  }, [
    cabinetId,
    cabinets,
    isAllowed,
    loading,
    remember,
    replaceCabinetInUrl,
    requestedCabinet,
  ]);

  const setCabinetId = useCallback(
    (nextCabinetId: string) => {
      if (!isAllowed(nextCabinetId)) return;
      pendingCabinet.current = nextCabinetId;
      setCabinetIdState(nextCabinetId);
      remember(nextCabinetId);
      replaceCabinetInUrl(nextCabinetId);
    },
    [isAllowed, remember, replaceCabinetInUrl],
  );

  const activeCabinet = useMemo(
    () => cabinets.find((cabinet) => cabinet.id === cabinetId) ?? null,
    [cabinetId, cabinets],
  );

  const value = useMemo<WbCabinetContextValue>(
    () => ({
      cabinets,
      cabinetId,
      activeCabinet,
      user,
      ready,
      loading,
      error,
      canUseAll,
      canWrite: cabinetId !== "all" && Boolean(activeCabinet),
      setCabinetId,
      refreshCabinets: () => setRefreshKey((key) => key + 1),
    }),
    [
      activeCabinet,
      cabinetId,
      cabinets,
      canUseAll,
      error,
      loading,
      ready,
      setCabinetId,
      user,
    ],
  );

  return <WbCabinetContext.Provider value={value}>{children}</WbCabinetContext.Provider>;
}

export function useWbCabinet() {
  const context = useContext(WbCabinetContext);
  if (!context) throw new Error("useWbCabinet должен использоваться внутри WbCabinetProvider");
  return context;
}
