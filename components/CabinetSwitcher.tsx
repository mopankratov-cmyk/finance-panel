"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Building2 } from "lucide-react";
import { useActiveCabinet } from "@/lib/useActiveCabinet";

interface Cab { id: string; name: string; marketplace: string }

// Переключатель активного кабинета для маркетплейса. onChange(id) — id или "" (все/первый).
export function CabinetSwitcher({ mp, accent = "sky", onChange }: { mp: "ozon" | "wb"; accent?: "sky" | "violet"; onChange?: (id: string) => void }) {
  const [id, setId] = useActiveCabinet(mp);
  const [cabs, setCabs] = useState<Cab[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/cabinets", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setCabs((j.cabinets ?? []).filter((c: Cab) => c.marketplace === mp))).catch(() => {});
  }, [mp]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  if (cabs.length <= 1) return null; // переключатель нужен только при 2+ кабинетах

  const active = cabs.find((c) => c.id === id);
  const label = active ? active.name : "Все кабинеты";
  const ring = accent === "violet" ? "focus:ring-violet-400 text-violet-700" : "focus:ring-sky-400 text-sky-700";
  const pick = (v: string) => { setId(v); onChange?.(v); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        title="Кабинет (юрлицо) — переключи, чтобы вся аналитика показала его срез"
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${ring} ${active ? (accent === "violet" ? "border-violet-300 bg-violet-50" : "border-sky-300 bg-sky-50") : "border-gray-300 bg-white"} hover:bg-gray-50`}>
        <Building2 className="h-3.5 w-3.5" /> <span className="max-w-[140px] truncate">{label}</span> <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <button onClick={() => pick("")} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${!id ? "font-semibold text-gray-900" : "text-gray-600"}`}>Все кабинеты</button>
          {cabs.map((c) => (
            <button key={c.id} onClick={() => pick(c.id)} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${id === c.id ? "font-semibold text-gray-900" : "text-gray-600"}`}>{c.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
