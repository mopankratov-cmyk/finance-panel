import { Suspense } from "react";
import { WbCabinetProvider } from "@/components/wb/WbCabinetContext";
import { WbShell } from "@/components/wb/WbShell";

function ShellFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f6f7f9]">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
    </div>
  );
}

export default function WbLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <WbCabinetProvider>
        <WbShell>{children}</WbShell>
      </WbCabinetProvider>
    </Suspense>
  );
}
