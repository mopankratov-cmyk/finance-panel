import { MarginByArticlePage } from "@/components/opiu/MarginByArticlePage";
import { FinanceTabs } from "@/components/FinanceTabs";

export default function Page() {
  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <FinanceTabs />
      </div>
      <div className="px-6 pb-6">
        <MarginByArticlePage />
      </div>
    </div>
  );
}
