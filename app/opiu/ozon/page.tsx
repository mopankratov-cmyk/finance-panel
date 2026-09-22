import { FinanceTabs } from "@/components/FinanceTabs";
import { OzonOpiuPage } from "@/components/opiu/OzonOpiuPage";

export default function Page() {
  return (
    <div>
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <FinanceTabs />
      </div>
      <OzonOpiuPage />
    </div>
  );
}
