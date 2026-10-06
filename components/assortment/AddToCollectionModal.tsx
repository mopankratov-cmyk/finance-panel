"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { COLLECTION_STATUS_LABEL } from "@/lib/assortment/collections";
import type { CollectionSummary } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_BASE_PATH, type AssortmentDirection } from "@/lib/assortment/constants";

/** Положить модель в подборку своего раздела: в свободное место или в резерв. */
export function AddToCollectionModal({
  direction,
  referenceId,
  onClose,
  onAdded,
}: {
  direction: AssortmentDirection;
  referenceId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<CollectionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assortment-development/collections")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body?.error || `Подборки не загрузились (${response.status})`);
        else setCollections((body.collections as CollectionSummary[]).filter((c) => c.direction === direction && c.status !== "archived"));
      })
      .catch(() => !cancelled && setError("Нет связи с сервером"));
    return () => {
      cancelled = true;
    };
  }, [direction]);

  const add = async (collection: CollectionSummary, asReserve: boolean) => {
    setBusy(`${collection.id}:${asReserve}`);
    setError(null);
    try {
      const response = await fetch(`/api/assortment-development/collections/${collection.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceId, asReserve }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не получилось (${response.status})`);
      setAdded(collection);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(null);
    }
  };

  const button = "inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm disabled:opacity-60";
  return (
    <Modal open onClose={onClose} title="В подборку" error={error} size="md">
      <div className="flex flex-col gap-3">
        {added ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            Добавлено в «{added.title}». <Link href={`${ASSORTMENT_BASE_PATH}/collections/${added.id}`} className="font-medium underline">Открыть подборку</Link>
          </div>
        ) : collections === null && !error ? (
          <div className="text-sm text-slate-500">Загружаем подборки…</div>
        ) : collections && collections.length === 0 ? (
          <p className="text-sm text-slate-600">
            Подборок раздела пока нет. <Link href={`${ASSORTMENT_BASE_PATH}/collections`} className="font-medium text-violet-700">Создайте план</Link> — и возвращайтесь.
          </p>
        ) : collections ? (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
            {collections.map((c) => {
              const bags = c.kind === "bags_month";
              const mainFull = bags && c.progress.freeSlots.length === 0;
              const reserveFull = c.progress.reserves >= 3;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{c.title}</div>
                    <div className="text-xs text-slate-500">{COLLECTION_STATUS_LABEL[c.status]} · {c.progress.label}</div>
                  </div>
                  <div className="flex gap-1.5">
                    {!mainFull && (
                      <button type="button" disabled={busy !== null} onClick={() => void add(c, false)} className={`${button} bg-violet-700 font-medium text-white hover:bg-violet-800`}>
                        {busy === `${c.id}:false` && <LoaderCircle className="h-4 w-4 animate-spin" />} Добавить
                      </button>
                    )}
                    {bags && !reserveFull && (
                      <button type="button" disabled={busy !== null} onClick={() => void add(c, true)} className={`${button} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                        {busy === `${c.id}:true` && <LoaderCircle className="h-4 w-4 animate-spin" />} В резерв
                      </button>
                    )}
                    {mainFull && reserveFull && <span className="text-xs text-slate-500">мест нет</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
