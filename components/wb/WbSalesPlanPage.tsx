"use client";

import { SalesPlanPage } from "@/components/planning/SalesPlanPage";
import { useWbCabinet } from "./WbCabinetContext";

export function WbSalesPlanPage() {
  const { cabinetId, activeCabinet, ready, loading, error, canWrite, user } = useWbCabinet();
  return (
    <SalesPlanPage
      marketplace="wb"
      cabinetId={cabinetId}
      cabinetName={activeCabinet?.name ?? "Wildberries"}
      ready={ready}
      cabinetLoading={loading}
      cabinetError={error}
      canWrite={canWrite}
      user={user}
    />
  );
}
