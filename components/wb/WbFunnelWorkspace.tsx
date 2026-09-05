"use client";

import { Filter, Tag } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WbFunnelPage } from "./WbFunnelPage";
import { WbModuleHeader } from "./WbModuleHeader";
import { WbRepricerPage } from "./WbRepricerPage";
import { useWbCabinet } from "./WbCabinetContext";

type WorkspaceView = "funnel" | "repricer";

export function WbFunnelWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCabinet, cabinetId, user } = useWbCabinet();
  const sellerReadOnly = user?.role === "seller";
  const view: WorkspaceView = !sellerReadOnly && searchParams.get("view") === "repricer" ? "repricer" : "funnel";

  const selectView = (nextView: WorkspaceView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === "funnel") params.delete("view");
    else params.set("view", nextView);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const Icon = view === "repricer" ? Tag : Filter;
  const cabinetLabel = activeCabinet?.name ?? (cabinetId === "all" ? "все кабинеты" : "WB");

  return (
    <div className="min-h-[calc(100dvh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Icon}
        title={sellerReadOnly ? "Воронка" : "Воронка / Репрайсер"}
        description={`${cabinetLabel} · ${sellerReadOnly ? "показы, переходы, корзины и заказы" : "единый контур метрик и решений цены"}`}
        actions={sellerReadOnly ? undefined : (
          <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm lg:min-h-8" role="tablist" aria-label="Раздел воронки">
            <button
              type="button"
              role="tab"
              aria-selected={view === "funnel"}
              onClick={() => selectView("funnel")}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:min-h-7 ${view === "funnel" ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Воронка
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "repricer"}
              onClick={() => selectView("repricer")}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:min-h-7 ${view === "repricer" ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Tag className="h-3.5 w-3.5" aria-hidden="true" />
              Репрайсер
            </button>
          </div>
        )}
      />

      {view === "repricer" ? <WbRepricerPage /> : <WbFunnelPage embedded />}
    </div>
  );
}
