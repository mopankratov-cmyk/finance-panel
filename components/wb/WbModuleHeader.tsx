import type { LucideIcon } from "lucide-react";

export function WbModuleHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[56px] flex-col gap-3 border-b border-slate-200 bg-[#f6f7f9] px-3 py-3 sm:px-6 lg:flex-row lg:items-center lg:py-2.5">
      <div className="flex min-w-0 items-start gap-2.5 lg:items-center">
        <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-600 lg:mt-0" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-6 tracking-[-0.02em] text-slate-800 sm:text-[20px]">{title}</h1>
          {description ? <div className="mt-0.5 text-[11px] leading-4 text-slate-400 lg:mt-0 lg:inline lg:pl-2">{description}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto lg:justify-end">{actions}</div> : null}
    </div>
  );
}

export function WbErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span>{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-3 min-h-8 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}

export function WbEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
