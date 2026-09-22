import { FinanceTabs } from "@/components/FinanceTabs";
import { OzonMarginByArticlePage } from "@/components/opiu/OzonMarginByArticlePage";

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-[110rem] px-3 pt-6 sm:px-6">
        <FinanceTabs />
      </div>
      <OzonMarginByArticlePage />
    </>
  );
}
