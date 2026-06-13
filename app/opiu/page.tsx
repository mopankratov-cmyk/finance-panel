import { OpiuPage } from "@/components/opiu/OpiuPage";
import { FinanceTabs } from "@/components/FinanceTabs";

export default function Page() {
  return (
    <div>
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <FinanceTabs />
      </div>
      <OpiuPage />
    </div>
  );
}
