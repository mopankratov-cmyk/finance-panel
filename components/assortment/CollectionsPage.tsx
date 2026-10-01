"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { COLLECTION_STATUS_LABEL, monthPeriod, periodLabel, seasonOptions, type CollectionKind } from "@/lib/assortment/collections";
import type { CollectionSummary } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_BASE_PATH, DIRECTION_LABEL, type AssortmentDirection } from "@/lib/assortment/constants";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; collections: CollectionSummary[] };

const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });

/** Подборки модуля: план сумок на месяц и доска курток на сезон. */
export function CollectionsPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState<AssortmentDirection | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assortment-development/collections")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setState({ kind: "error", message: body?.error || `Подборки не загрузились (${response.status})` });
        else setState({ kind: "ready", collections: body.collections ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = state.kind === "ready" ? state.collections : [];
  const archived = all.filter((c) => c.status === "archived").length;
  const visible = all.filter((c) => showArchived || c.status !== "archived");

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-slate-900">Подборки</h1>
            <p className="max-w-2xl text-sm text-slate-500">
              План сумок — пять разных конструктивных идей и до трёх резервных. Доска курток — на сезон, без обязательного количества.
              Это план изучения и разработки образцов для своей фабрики, а не заказ партии.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCreating("bags")} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800">
              <Plus className="h-4 w-4" /> План сумок
            </button>
            <button type="button" onClick={() => setCreating("jackets")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50">
              <Plus className="h-4 w-4" /> Доска курток
            </button>
          </div>
        </header>

        {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем подборки…</div>}
        {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}

        {state.kind === "ready" && visible.length === 0 && (
          <section className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <div className="text-base font-semibold text-slate-900">Подборок пока нет</div>
            <p className="max-w-xl text-sm leading-6 text-slate-600">Начните с плана сумок на месяц или доски курток на сезон — кандидаты берутся из ленты раздела.</p>
          </section>
        )}

        {visible.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <li key={c.id}>
                <Link href={`${ASSORTMENT_BASE_PATH}/collections/${c.id}`} className="flex h-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-violet-300">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{c.title}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {COLLECTION_STATUS_LABEL[c.status]}{c.status === "saved" && ` · v${c.version}`}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600">{DIRECTION_LABEL[c.direction]} · {c.progress.label}</div>
                  <div className="text-xs text-slate-500">
                    Изменена {day(c.updatedAt)}{c.responsible && ` · отвечает ${c.responsible}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {archived > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="h-10 self-start rounded-lg px-2 text-sm text-violet-700 hover:text-violet-900">
            {showArchived ? "Скрыть архив" : `Показать архив (${archived})`}
          </button>
        )}
      </div>

      {creating && (
        <CreateModal
          direction={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => router.push(`${ASSORTMENT_BASE_PATH}/collections/${id}`)}
        />
      )}
    </div>
  );
}

function CreateModal({ direction, onClose, onCreated }: { direction: AssortmentDirection; onClose: () => void; onCreated: (id: string) => void }) {
  const kind: CollectionKind = direction === "bags" ? "bags_month" : "jackets_season";
  const options = useMemo(() => {
    const now = new Date();
    return direction === "bags"
      ? [0, 1, 2].map((offset) => ({ period: monthPeriod(now, offset), label: periodLabel(monthPeriod(now, offset)) }))
      : seasonOptions(now);
  }, [direction]);
  const [period, setPeriod] = useState(options[direction === "bags" ? 1 : 0].period);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/assortment-development/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, kind, period }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не получилось (${response.status})`);
      onCreated(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800">Отмена</button>
      <button type="button" onClick={create} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white disabled:opacity-60">
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Создать
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={direction === "bags" ? "План сумок на месяц" : "Доска курток на сезон"} footer={footer} size="sm">
      <div className="flex flex-col gap-3">
        <span className="text-sm text-slate-600">{direction === "bags" ? "Месяц" : "Сезон"}</span>
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o.period} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-800 hover:bg-slate-50">
              <input type="radio" name="period" checked={period === o.period} onChange={() => setPeriod(o.period)} className="h-4 w-4 accent-violet-700" />
              {o.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">Если подборка на этот период уже есть — откроется она, вторая не создаётся.</p>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      </div>
    </Modal>
  );
}
