"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Building2, Layers3 } from "lucide-react";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import type { CabinetGroup } from "@/app/api/cabinet-groups/route";
import { shouldShowCabinetSwitcher } from "@/lib/unit/groupListing";

interface Cab { id: string; name: string; marketplace: string }

// Переключатель активного кабинета для маркетплейса. onChange(id) — id, "group:<id>" или "" (все).
export function CabinetSwitcher({ mp, accent = "sky", onChange }: { mp: "ozon" | "wb"; accent?: "sky" | "violet"; onChange?: (id: string) => void }) {
  const [id, setId] = useActiveCabinet(mp);
  const [cabs, setCabs] = useState<Cab[]>([]);
  const [groups, setGroups] = useState<CabinetGroup[]>([]);
  const [groupsError, setGroupsError] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cabinets?accessible=1", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setCabs((j.cabinets ?? []).filter((c: Cab) => c.marketplace === mp))).catch(() => {});
    setGroupsError("");
    fetch(`/api/cabinet-groups?mp=${mp}`, { cache: "no-store", signal: controller.signal }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Не удалось загрузить группы");
      return j;
    }).then((j) => setGroups(j.groups ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGroups([]);
        setGroupsError("Группы кабинетов временно недоступны");
      });
    return () => controller.abort();
  }, [mp]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  if (!shouldShowCabinetSwitcher(cabs.length, groups.length)) {
    return groupsError ? <span role="alert" className="text-xs text-red-600">{groupsError}</span> : null;
  }

  const activeGroup = id.startsWith("group:") ? groups.find((g) => `group:${g.id}` === id) : undefined;
  const active = cabs.find((c) => c.id === id);
  const label = activeGroup ? activeGroup.name : active ? active.name : "Все кабинеты";
  const ring = accent === "violet" ? "focus:ring-violet-400 text-violet-700" : "focus:ring-sky-400 text-sky-700";
  const pick = (v: string) => { setId(v); onChange?.(v); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        title="Кабинет (юрлицо) — переключи, чтобы вся аналитика показала его срез"
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${ring} ${active || activeGroup ? (accent === "violet" ? "border-violet-300 bg-violet-50" : "border-sky-300 bg-sky-50") : "border-gray-300 bg-white"} hover:bg-gray-50`}>
        {activeGroup ? <Layers3 className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />} <span className="max-w-[140px] truncate">{label}</span> <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <button onClick={() => pick("")} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${!id ? "font-semibold text-gray-900" : "text-gray-600"}`}>Все кабинеты</button>
          {cabs.map((c) => (
            <button key={c.id} onClick={() => pick(c.id)} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${id === c.id ? "font-semibold text-gray-900" : "text-gray-600"}`}>{c.name}</button>
          ))}
          {groups.length > 0 && (
            <>
              <div className="mt-1 border-t border-gray-100 px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Группы</div>
              {groups.map((g) => (
                <button key={g.id} onClick={() => pick(`group:${g.id}`)} className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${id === `group:${g.id}` ? "font-semibold text-gray-900" : "text-gray-600"}`}>
                  <Layers3 className="h-3 w-3 shrink-0 text-gray-400" /> {g.name}
                </button>
              ))}
            </>
          )}
          {groupsError && (
            <div role="alert" className="border-t border-red-100 px-3 py-2 text-xs text-red-600">{groupsError}</div>
          )}
        </div>
      )}
    </div>
  );
}
