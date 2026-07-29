import type { LucideIcon } from "lucide-react";
import { ActionableError } from "@/components/ui/ActionableError";

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
    <div className="flex min-h-[56px] flex-col gap-3 border-b border-slate-200 bg-[#f6f7f9] px-3 py-3 sm:px-6 xl:flex-row xl:items-center xl:py-2.5">
      <div className="flex min-w-0 items-start gap-2.5 xl:items-center">
        <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-600 xl:mt-0" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-6 tracking-[-0.02em] text-slate-800 sm:text-[20px]">{title}</h1>
          {description ? <div className="mt-0.5 text-[11px] leading-4 text-slate-400 xl:mt-0 xl:inline xl:pl-2">{description}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 xl:ml-auto xl:justify-end">{actions}</div> : null}
    </div>
  );
}

export function WbErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <ActionableError message={message} label="WB" onRetry={onRetry} />;
}

export function WbEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
