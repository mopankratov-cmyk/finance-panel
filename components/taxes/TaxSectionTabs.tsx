import Link from "next/link";

export function TaxSectionTabs({ active }: { active: "taxes" | "cashout" }) {
  return <nav aria-label="Разделы налогов" className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
    <Link href="/pnl/taxes" aria-current={active === "taxes" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${active === "taxes" ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Расчёт налогов</Link>
    <Link href="/pnl/taxes/cashout" aria-current={active === "cashout" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${active === "cashout" ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Движение наличных</Link>
  </nav>;
}
