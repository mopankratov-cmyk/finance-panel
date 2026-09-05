import { Suspense } from "react";
import { OzonCabinetProvider } from "@/components/ozon/OzonCabinetContext";
import { OzonShell } from "@/components/ozon/OzonShell";

export default function OzonLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-slate-50 text-sm text-slate-500">Загрузка Ozon…</div>}><OzonCabinetProvider><OzonShell>{children}</OzonShell></OzonCabinetProvider></Suspense>;
}
