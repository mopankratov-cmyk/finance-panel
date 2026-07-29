import { FinanceTabs } from "@/components/FinanceTabs";
import { UnitMarginPage } from "@/components/opiu/UnitMarginPage";

export default function UnitMarginFinancePage() {
  return (
    <>
      <div className="mx-auto max-w-[110rem] px-3 pt-6 sm:px-6">
        <FinanceTabs />
      </div>
      <UnitMarginPage />
    </>
  );
}
