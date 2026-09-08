import { FinanceTabs } from "@/components/FinanceTabs";
import { MarginByArticlePage } from "@/components/opiu/MarginByArticlePage";

export default function UnitMarginFinancePage() {
  return (
    <>
      <div className="mx-auto max-w-[110rem] px-3 pt-6 sm:px-6">
        <FinanceTabs />
      </div>
      <MarginByArticlePage />
    </>
  );
}
