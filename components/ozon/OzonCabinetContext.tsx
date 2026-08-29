"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { withOzonCabinetScope } from "@/lib/ozon/navigation";

export interface OzonCabinet {
  id: string;
  name: string;
  marketplace: string;
  client_id?: string | null;
  seller_id?: string | null;
  is_active?: boolean;
}

export interface OzonCabinetGroup {
  id: number;
  name: string;
  marketplace: string;
  memberIds: string[];
}

interface SessionUser {
  email: string;
  role: "director" | "finance" | "manager";
  cabinet_ids: string[];
}

interface OzonCabinetContextValue {
  cabinets: OzonCabinet[];
  groups: OzonCabinetGroup[];
  cabinetId: string;
  activeCabinet: OzonCabinet | null;
  activeGroup: OzonCabinetGroup | null;
  user: SessionUser | null;
  ready: boolean;
  /** Кабинетов нет вовсе: экрану нечего показывать, и это не ошибка. */
  noCabinets: boolean;
  loading: boolean;
  error: string | null;
  canUseAll: boolean;
  canWrite: boolean;
  setCabinetId: (cabinetId: string) => void;
  refreshCabinets: () => void;
}

const OzonCabinetContext = createContext<OzonCabinetContextValue | null>(null);
const STORAGE_KEY = "fp_cab_ozon";

export function OzonCabinetProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedCabinet = searchParams.get("cabinet");
  const [cabinets, setCabinets] = useState<OzonCabinet[]>([]);
  const [groups, setGroups] = useState<OzonCabinetGroup[]>([]);
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
      fetch("/api/cabinets?accessible=1", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body as { cabinets?: OzonCabinet[] };
      }),
      fetch("/api/cabinet-groups?mp=ozon", { cache: "no-store", signal: controller.signal }).then((response) => response.json() as Promise<{ groups?: OzonCabinetGroup[] }>),
      fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }).then((response) => response.json() as Promise<{ user?: SessionUser | null }>),
    ])
      .then(([cabinetResponse, groupResponse, meResponse]) => {
        const ozonCabinets = (cabinetResponse.cabinets ?? []).filter((cabinet) => cabinet.marketplace === "ozon" && cabinet.is_active !== false);
        const ids = new Set(ozonCabinets.map((cabinet) => cabinet.id));
        setCabinets(ozonCabinets);
        setGroups((groupResponse.groups ?? [])
          .map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => ids.has(id)) }))
          .filter((group) => group.memberIds.length > 0));
        setUser(meResponse.user ?? null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить Ozon-кабинеты");
        setCabinets([]);
        setGroups([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const canUseAll = !(user?.role === "manager" && user.cabinet_ids.length > 0);
  const isAllowed = useCallback((candidate: string | null | undefined) => {
    if (!candidate) return false;
    if (candidate === "all") return canUseAll && cabinets.length > 1;
    if (candidate.startsWith("group:")) {
      return groups.some((group) => `group:${group.id}` === candidate && group.memberIds.length > 0);
    }
    return cabinets.some((cabinet) => cabinet.id === candidate);
  }, [cabinets, canUseAll, groups]);

  const replaceCabinetInUrl = useCallback((nextCabinetId: string) => {
    const href = withOzonCabinetScope(`${pathname}?${searchParams.toString()}`, nextCabinetId);
    window.history.replaceState(null, "", href);
  }, [pathname, searchParams]);

  const remember = useCallback((value: string) => {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* URL остаётся источником контекста. */ }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (pendingCabinet.current && requestedCabinet !== pendingCabinet.current) return;
    if (pendingCabinet.current === requestedCabinet) pendingCabinet.current = null;
    let stored = "";
    try { stored = localStorage.getItem(STORAGE_KEY) ?? ""; } catch { /* ignore */ }
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
    if (requestedCabinet !== next) {
      pendingCabinet.current = next;
      replaceCabinetInUrl(next);
    }
    setReady(true);
  }, [cabinetId, cabinets, isAllowed, loading, remember, replaceCabinetInUrl, requestedCabinet]);

  const setCabinetId = useCallback((nextCabinetId: string) => {
    if (!isAllowed(nextCabinetId)) return;
    pendingCabinet.current = nextCabinetId;
    setCabinetIdState(nextCabinetId);
    remember(nextCabinetId);
    replaceCabinetInUrl(nextCabinetId);
  }, [isAllowed, remember, replaceCabinetInUrl]);

  const activeCabinet = useMemo(() => cabinets.find((cabinet) => cabinet.id === cabinetId) ?? null, [cabinetId, cabinets]);
  const activeGroup = useMemo(() => groups.find((group) => `group:${group.id}` === cabinetId) ?? null, [cabinetId, groups]);
  const value = useMemo<OzonCabinetContextValue>(() => ({
    cabinets,
    groups,
    cabinetId,
    activeCabinet,
    activeGroup,
    user,
    ready,
    noCabinets: !loading && cabinets.length === 0 && groups.length === 0,
    loading,
    error,
    canUseAll,
    canWrite: Boolean(activeCabinet),
    setCabinetId,
    refreshCabinets: () => setRefreshKey((key) => key + 1),
  }), [activeCabinet, activeGroup, cabinetId, cabinets, canUseAll, error, groups, loading, ready, setCabinetId, user]);

  return <OzonCabinetContext.Provider value={value}>{children}</OzonCabinetContext.Provider>;
}

export function useOzonCabinet() {
  const context = useContext(OzonCabinetContext);
  if (!context) throw new Error("useOzonCabinet должен использоваться внутри OzonCabinetProvider");
  return context;
}
