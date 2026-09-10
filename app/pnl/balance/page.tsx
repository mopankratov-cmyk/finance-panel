import { FinanceTabs } from "@/components/FinanceTabs";
import { Scale } from "lucide-react";

export default function BalancePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <FinanceTabs />

      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Баланс</h1>
          <p className="mt-1 text-sm text-slate-500">
            Каркас раздела создан. Состав активов, обязательств и капитала будет разработан отдельным этапом.
          </p>
        </div>
      </div>
    </div>
  );
}
