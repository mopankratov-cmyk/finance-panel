"use client";

import { ACCESS_STATUS_LABEL, type AccessStatus } from "@/lib/assortment/constants";
import { crawlStatus, type AssortmentSource } from "@/lib/assortment/coverage";

const STATUS_STYLE: Record<AccessStatus, string> = {
  auto_verified: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-900",
  manual_only: "bg-slate-200 text-slate-700",
  untested: "bg-blue-100 text-blue-800",
  unavailable: "bg-red-50 text-red-800",
  disabled: "bg-slate-100 text-slate-600",
};

/** Паспорт источников: статус доступа по факту проверки и пояснение. */
export function SourcesList({ sources }: { sources: AssortmentSource[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {sources.map((source) => (
        <li key={source.sourceId} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium text-slate-900">{source.name}</span>
            <span className="font-mono text-[11px] text-slate-500">{source.sourceId}</span>
          </div>
          <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[source.accessStatus]}`}>
            {ACCESS_STATUS_LABEL[source.accessStatus]}
          </span>
          {source.accessNote && <span className="text-xs leading-5 text-slate-600">{source.accessNote}</span>}
          {(() => {
            const status = crawlStatus(source);
            return status ? <span className={`text-xs leading-5 ${status.failing ? "text-red-700" : "text-green-700"}`}>{status.text}</span> : null;
          })()}
        </li>
      ))}
    </ul>
  );
}
