"use client";

import { SalesPlanPage } from "@/components/planning/SalesPlanPage";
import { useOzonCabinet } from "./OzonCabinetContext";

export function OzonSalesPlanPage() {
  const { cabinetId, activeCabinet, ready, loading, error, canWrite, user } = useOzonCabinet();
  return (
    <SalesPlanPage
      marketplace="ozon"
      cabinetId={cabinetId}
      cabinetName={activeCabinet?.name ?? "Ozon"}
      ready={ready}
      cabinetLoading={loading}
      cabinetError={error}
      canWrite={canWrite}
      user={user}
    />
  );
}
