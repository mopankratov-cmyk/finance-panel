"use client";

import { Check, Loader2, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Ярлыки РНП на других экранах WB (Воронка, Полки).
 *
 * Ярлык вешается на nm-артикулы (например, все цвета одной модели) и хранится
 * per-кабинет. Экраны используют его как фильтр «покажи все цвета модели
 * разом»; повесить или снять ярлык можно там же, где он нужен, — создание и
 * переименование остаются в РНП.
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
  // Счётчик перечитывания: после назначения ярлыка экран обязан увидеть то,
  // что реально записалось, а не то, что он предположил.
  const [reloadToken, setReloadToken] = useState(0);

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
  }, [cabinetId, reloadToken]);

  return { tags, tagIdsByNm, reloadTags: () => setReloadToken((value) => value + 1) };
}

/** true, если у товара есть хотя бы один из активных ярлыков. */
export function nmMatchesTags(tagIdsByNm: Map<number, string[]>, nm: number, activeIds: string[]) {
  if (!activeIds.length) return true;
  const assigned = tagIdsByNm.get(nm);
  return Boolean(assigned && assigned.some((id) => activeIds.includes(id)));
}

export function WbTagFilterChips({ tags, activeIds, counts, onToggle, onClear, showEmpty }: {
  tags: WbTagOption[];
  activeIds: string[];
  /** Сколько строк текущего экрана несут ярлык — чтобы пустые были видны сразу. */
  counts: Map<string, number>;
  onToggle: (tagId: string) => void;
  onClear: () => void;
  /**
   * Показывать ярлыки, которых нет ни на одной строке экрана. Нужно там, где
   * ярлык вешают прямо в таблице: пока он не присвоен никому, панель без него
   * не отрисовывалась вовсе — и фильтра будто не существовало.
   */
  showEmpty?: boolean;
}) {
  const visible = useMemo(
    () => showEmpty ? tags : tags.filter((tag) => (counts.get(tag.id) ?? 0) > 0 || activeIds.includes(tag.id)),
    [activeIds, counts, showEmpty, tags],
  );
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
            title={(counts.get(tag.id) ?? 0) === 0 ? "На этом экране ярлык пока никому не присвоен" : undefined}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold transition ${
              active ? "border-violet-400 bg-violet-50 text-violet-800"
                : (counts.get(tag.id) ?? 0) === 0 ? "border-dashed border-slate-200 bg-white text-slate-400 hover:border-slate-300"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
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

/**
 * Повесить или снять ярлык на артикул с того экрана, где он понадобился.
 * Возвращает true, если сервер принял изменение — вызывающий перечитывает
 * список сам, чтобы не расходиться с базой.
 */
export async function setWbTagAssignment(
  cabinetId: string,
  nmId: number,
  tagId: string,
  assigned: boolean,
): Promise<boolean> {
  const response = await fetch(`/api/rnp/${encodeURIComponent(cabinetId)}/operations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_tag", nmIds: [nmId], tagId, assigned }),
  });
  return response.ok;
}

/** Компактный выбор ярлыков для строки таблицы. */
export function WbTagPicker({ tags, assignedIds, onToggle }: {
  tags: WbTagOption[];
  assignedIds: string[];
  onToggle: (tagId: string, assigned: boolean) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Меню уходит порталом в body: ячейки таблицы липкие, они создают свой
  // слой, и выпадашка внутри них не перехватывала клики — те проваливались
  // на строку под меню и вместо выбора ярлыка раскрывали соседний артикул.
  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 4, left: rect.left });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <span className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          place();
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-label="Ярлыки артикула"
        className="rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
      >
        {assignedIds.length ? `ярлыков: ${assignedIds.length}` : "+ ярлык"}
      </button>
      {open && anchor ? createPortal(
        <>
          <button
            type="button"
            className="fixed inset-0 z-[998] cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Закрыть выбор ярлыков"
          />
          <div
            className="fixed z-[999] w-56 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-[0_18px_55px_rgba(15,23,42,0.18)]"
            style={{ top: anchor.top, left: anchor.left }}
          >
            {tags.length ? tags.map((tag) => {
              const assigned = assignedIds.includes(tag.id);
              const pending = pendingId === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    setPendingId(tag.id);
                    await onToggle(tag.id, !assigned);
                    setPendingId(null);
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  {pending ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : assigned ? <Check className="h-3 w-3 text-violet-600" /> : null}
                </button>
              );
            }) : <p className="px-2 py-2 text-[10px] text-slate-400">Ярлыков нет — создайте их в РНП.</p>}
          </div>
        </>,
        document.body,
      ) : null}
    </span>
  );
}
