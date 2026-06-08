"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  header?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  wide?: boolean;
  narrow?: boolean;
  fixedWidth?: number;
}

export function SlidePanel({
  open,
  onClose,
  title,
  header,
  children,
  bare = false,
  wide = false,
  narrow = false,
  fixedWidth,
}: SlidePanelProps) {
  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 flex h-full flex-col bg-slate-900 shadow-2xl transition-transform duration-300 ease-out ${
          fixedWidth
            ? "w-full"
            : narrow
              ? "w-full max-w-sm sm:max-w-md"
              : wide
                ? "w-full max-w-4xl"
                : "w-full max-w-3xl"
        } ${open ? "translate-x-0" : "translate-x-full"}`}
        style={fixedWidth ? { maxWidth: fixedWidth, width: "100%" } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {bare ? (
          <>
            <button
              onClick={onClose}
              className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between border-b border-slate-700/80 px-4 py-4 sm:px-6">
              {header ?? (
                <h2 className="text-lg font-semibold text-white">{title}</h2>
              )}
              <button
                onClick={onClose}
                className="ml-4 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {children}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
