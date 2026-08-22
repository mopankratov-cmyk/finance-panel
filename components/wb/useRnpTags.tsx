"use client";

import { Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/**
 * Ярлыки РНП на других экранах WB (Воронка, Полки).
 *
 * Ярлык вешается в РНП на nm-артикулы (например, все цвета одной модели) и
 * хранится per-кабинет. Здесь он используется только для чтения: фильтр
 * «покажи все цвета модели разом». Управление ярлыками остаётся в РНП.
 */
export interface WbTagOption {
  id: string;
  name: string;
  color: string;
}

interface OperationsPayload {
  available?: boolean;
  tags?: WbTagOption[];
  assignments?: Array<{ nm_id: number; tag_id: string }>;
}

export function useRnpTags(cabinetId: string | null | undefined) {
  const [tags, setTags] = useState<WbTagOption[]>([]);
  const [tagIdsByNm, setTagIdsByNm] = useState<Map<number, string[]>>(new Map());

  useEffect(() => {
    setTags([]);
    setTagIdsByNm(new Map());
    // Ярлыки живут в кабинете: в режиме «все кабинеты» им нечего показывать.
    if (!cabinetId || cabinetId === "all") return;
    const controller = new AbortController();
    fetch(`/api/rnp/${encodeURIComponent(cabinetId)}/operations`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? (response.json() as Promise<OperationsPayload>) : null)
      .then((body) => {
        if (!body || controller.signal.aborted) return;
        const map = new Map<number, string[]>();
        for (const item of body.assignments ?? []) {
          const list = map.get(item.nm_id) ?? [];
          list.push(item.tag_id);
          map.set(item.nm_id, list);
        }
        setTags(body.tags ?? []);
        setTagIdsByNm(map);
      })
      // Ярлыки — вспомогательный слой: их недоступность не должна ронять экран.
      .catch(() => {});
    return () => controller.abort();
  }, [cabinetId]);

  return { tags, tagIdsByNm };
}

/** true, если у товара есть хотя бы один из активных ярлыков. */
export function nmMatchesTags(tagIdsByNm: Map<number, string[]>, nm: number, activeIds: string[]) {
  if (!activeIds.length) return true;
  const assigned = tagIdsByNm.get(nm);
  return Boolean(assigned && assigned.some((id) => activeIds.includes(id)));
}

export function WbTagFilterChips({ tags, activeIds, counts, onToggle, onClear }: {
  tags: WbTagOption[];
  activeIds: string[];
  /** Сколько строк текущего экрана несут ярлык — чтобы пустые были видны сразу. */
  counts: Map<string, number>;
  onToggle: (tagId: string) => void;
  onClear: () => void;
}) {
  const visible = useMemo(() => tags.filter((tag) => (counts.get(tag.id) ?? 0) > 0 || activeIds.includes(tag.id)), [activeIds, counts, tags]);
  if (!visible.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Фильтр по ярлыкам">
      <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        <Tag className="h-3 w-3" /> Ярлыки
      </span>
      {visible.map((tag) => {
        const active = activeIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(tag.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold transition ${
              active ? "border-violet-400 bg-violet-50 text-violet-800" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
            {tag.name}
            <span className="tabular-nums text-slate-400">{counts.get(tag.id) ?? 0}</span>
          </button>
        );
      })}
      {activeIds.length ? (
        <button type="button" onClick={onClear} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-semibold text-slate-400 hover:text-slate-600" aria-label="Сбросить фильтр по ярлыкам">
          <X className="h-3 w-3" /> сбросить
        </button>
      ) : null}
    </div>
  );
}
