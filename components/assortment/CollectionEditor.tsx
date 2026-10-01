"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, FileText, ImageOff, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  BAGS_MAIN_SLOTS,
  COLLECTION_STATUS_LABEL,
  jacketGroups,
  MAX_DETAILS,
  MAX_RESERVES,
  periodLabel,
  REPLACE_REASONS,
  type ReplaceReason,
} from "@/lib/assortment/collections";
import type { CandidateCard, CollectionDetail, CollectionItemView, DraftView } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_BASE_PATH, DIRECTION_LABEL } from "@/lib/assortment/constants";
import { STATUS_LABEL } from "@/lib/assortment/decisions";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; collection: CollectionDetail };

async function call(url: string, init: RequestInit = {}): Promise<CollectionDetail> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Не получилось (${response.status})`);
  return body.collection as CollectionDetail;
}

/** Редактор подборки: места и резерв, задание по каждой модели, версии. */
export function CollectionEditor({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ asReserve: boolean; slot: number | null } | null>(null);
  const [editing, setEditing] = useState<CollectionItemView | null>(null);
  const [removing, setRemoving] = useState<{ item: CollectionItemView; replace: boolean } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const base = `/api/assortment-development/collections/${id}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(base);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setState({ kind: "error", message: body?.error || `Подборка не загрузилась (${response.status})` });
      else setState({ kind: "ready", collection: body.collection });
    } catch {
      setState({ kind: "error", message: "Нет связи с сервером" });
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, request: () => Promise<CollectionDetail>) => {
    setBusy(label);
    setError(null);
    try {
      setState({ kind: "ready", collection: await request() });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (state.kind === "loading") return <div className="px-3 py-6 text-sm text-slate-500 sm:px-6">Загружаем подборку…</div>;
  if (state.kind === "error") {
    return (
      <div className="px-3 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          <Link href={`${ASSORTMENT_BASE_PATH}/collections`} className="inline-flex h-10 items-center gap-1.5 self-start text-sm text-violet-700"><ArrowLeft className="h-4 w-4" /> Подборки</Link>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>
        </div>
      </div>
    );
  }

  const c = state.collection;
  const isBags = c.kind === "bags_month";
  const archived = c.status === "archived";
  const main = c.items.filter((i) => !i.isReserve);
  const reserves = c.items.filter((i) => i.isReserve);
  const latest = c.versions[0];
  const canAddReserve = isBags && reserves.length < MAX_RESERVES;
  const canDraft = isBags && !archived && (main.length < BAGS_MAIN_SLOTS || canAddReserve);

  const itemActions = {
    edit: (item: CollectionItemView) => setEditing(item),
    move: (item: CollectionItemView) => void run(`move:${item.id}`, () => call(`${base}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ moveTo: item.isReserve ? "main" : "reserve" }) })),
    replace: (item: CollectionItemView) => setRemoving({ item, replace: true }),
    remove: (item: CollectionItemView) => setRemoving({ item, replace: false }),
  };
  const slotFree = isBags && main.length < BAGS_MAIN_SLOTS;

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <Link href={`${ASSORTMENT_BASE_PATH}/collections`} className="inline-flex h-10 items-center gap-1.5 self-start text-sm text-violet-700 hover:text-violet-900">
          <ArrowLeft className="h-4 w-4" /> Подборки
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold text-slate-900 break-anywhere">{c.title}</h1>
            <div className="text-sm text-slate-500">
              {DIRECTION_LABEL[c.direction]} · {periodLabel(c.period)} · {COLLECTION_STATUS_LABEL[c.status]}
              {latest && ` · версия ${latest.version}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canDraft && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setDrafting(true)}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 px-4 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" /> Собрать черновик
              </button>
            )}
            {!archived && c.items.length > 0 && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("save", () => call(`${base}/save`, { method: "POST", body: JSON.stringify({ version: c.version }) }))}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60"
              >
                {busy === "save" && <LoaderCircle className="h-4 w-4 animate-spin" />} Сохранить версию
              </button>
            )}
            {latest && (
              <Link href={`${ASSORTMENT_BASE_PATH}/collections/${c.id}/brief?version=${latest.version}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50">
                <FileText className="h-4 w-4" /> Задание на образец
              </Link>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("archive", () => call(base, { method: "PATCH", body: JSON.stringify({ archive: !archived }) }))}
              className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {archived ? "Вернуть из архива" : "В архив"}
            </button>
          </div>
        </header>

        {latest && c.dirty && !archived && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Есть изменения после версии {latest.version}. Задание собирается из сохранённой версии — сохраните, чтобы они туда попали.
          </div>
        )}
        {!c.briefSupported && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Поля «отличия нашей модели», «вопросы к образцу», «сезон и аудитория» и «ответственный» появятся после миграции 202610020001. Без неё в задание попадут идея, детали и следующий шаг.
          </div>
        )}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {c.briefSupported && (
          <ResponsibleField
            value={c.responsible}
            disabled={archived || busy !== null}
            onSave={(value) => run("responsible", () => call(base, { method: "PATCH", body: JSON.stringify({ responsible: value }) }))}
          />
        )}

        {isBags ? (
          <>
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Пять идей · {main.length} из {BAGS_MAIN_SLOTS}</h2>
                {main.length < BAGS_MAIN_SLOTS && (
                  <span className="text-sm text-slate-500">Нужны разные конструкции: расцветки одной модели за отдельную идею не считаются.</span>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {Array.from({ length: BAGS_MAIN_SLOTS }, (_, i) => i + 1).map((slot) => {
                  const item = main.find((m) => m.slot === slot);
                  return item ? (
                    <ItemCard key={item.id} item={item} label={`Модель ${slot}`} busy={busy} archived={archived} isBags actions={itemActions} />
                  ) : (
                    <li key={`slot-${slot}`} className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center">
                      <span className="text-sm text-slate-500">Модель {slot} — пусто</span>
                      {!archived && (
                        <button type="button" onClick={() => setPicking({ asReserve: false, slot })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">
                          <Plus className="h-4 w-4" /> Выбрать
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Резерв · {reserves.length} из {MAX_RESERVES}</h2>
                {canAddReserve && !archived && (
                  <button type="button" onClick={() => setPicking({ asReserve: true, slot: null })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                    <Plus className="h-4 w-4" /> В резерв
                  </button>
                )}
              </div>
              {reserves.length > 0 ? (
                <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {reserves.map((item, index) => (
                    <ItemCard key={item.id} item={item} label={`Резерв ${index + 1}`} busy={busy} archived={archived} isBags canMoveToMain={slotFree} actions={itemActions} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Резерв пуст — сюда кладут запасные идеи на случай замены.</p>
              )}
            </section>
          </>
        ) : (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Доска сезона · {c.progress.label}</h2>
              {!archived && (
                <button type="button" onClick={() => setPicking({ asReserve: false, slot: null })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
                  <Plus className="h-4 w-4" /> Добавить модель
                </button>
              )}
            </div>
            {c.items.length === 0 && <p className="text-sm text-slate-500">Добавьте модели из ленты «Куртки» — доска сгруппирует их по подтипу и силуэту.</p>}
            {jacketGroups(c.items).map((group) => (
              <div key={group.subtype} className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-slate-800">{group.subtype}</h3>
                {group.groups.map((sub) => (
                  <div key={sub.silhouette} className="flex flex-col gap-2">
                    <div className="text-sm text-slate-500">{sub.silhouette}</div>
                    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {sub.items.map((item) => (
                        <ItemCard key={item.id} item={item} label={null} busy={busy} archived={archived} isBags={false} actions={itemActions} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-xs text-slate-500">Подтип и силуэт берутся из признаков модели — заполните их в карточке, если группа «не указан».</p>
          </section>
        )}
      </div>

      {picking && (
        <CandidatePicker
          collectionId={c.id}
          asReserve={picking.asReserve}
          isBags={isBags}
          onClose={() => setPicking(null)}
          onAdd={async (referenceId, asReserve) => {
            const ok = await run(`add:${referenceId}`, () => call(base, { method: "POST", body: JSON.stringify({ referenceId, asReserve, slot: picking.slot }) }));
            if (ok) setPicking(null);
          }}
          busy={busy}
        />
      )}
      {drafting && (
        <DraftModal
          collectionId={c.id}
          busy={busy === "draft"}
          onClose={() => setDrafting(false)}
          onApply={async (picks) => {
            const ok = await run("draft", async () => {
              let latest: CollectionDetail | null = null;
              for (const pick of picks) {
                latest = await call(base, { method: "POST", body: JSON.stringify({ referenceId: pick.id, asReserve: pick.place === "reserve" }) });
              }
              return latest ?? (await call(base));
            });
            if (ok) setDrafting(false);
          }}
        />
      )}
      {editing && (
        <ItemEditor
          item={editing}
          briefSupported={c.briefSupported}
          busy={busy === "item"}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const ok = await run("item", () => call(`${base}/items/${editing.id}`, { method: "PATCH", body: JSON.stringify(patch) }));
            if (ok) setEditing(null);
          }}
        />
      )}
      {removing && (
        <RemoveModal
          item={removing.item}
          replace={removing.replace}
          busy={busy === "remove"}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            const query = reason ? `?reason=${reason}` : "";
            const ok = await run("remove", () => call(`${base}/items/${removing.item.id}${query}`, { method: "DELETE" }));
            if (ok) {
              const { isReserve, slot } = removing.item;
              const replace = removing.replace;
              setRemoving(null);
              if (replace) setPicking({ asReserve: isReserve, slot: isReserve ? null : slot });
            }
          }}
        />
      )}
    </div>
  );
}

function ResponsibleField({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (value: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const changed = draft.trim() !== (value ?? "");
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void onSave(draft); }}>
      <label htmlFor="responsible" className="text-sm text-slate-600">Ответственный за задание</label>
      <input
        id="responsible"
        value={draft}
        maxLength={120}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Имя или почта"
        className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-violet-500 sm:max-w-xs"
      />
      {changed && <button type="submit" className="h-10 rounded-lg bg-violet-700 px-3 text-sm text-white">Сохранить</button>}
    </form>
  );
}

interface ItemActions {
  edit: (item: CollectionItemView) => void;
  move: (item: CollectionItemView) => void;
  replace: (item: CollectionItemView) => void;
  remove: (item: CollectionItemView) => void;
}

function ItemCard({
  item,
  label,
  busy,
  archived,
  isBags,
  canMoveToMain = false,
  actions,
}: {
  item: CollectionItemView;
  label: string | null;
  busy: string | null;
  archived: boolean;
  isBags: boolean;
  canMoveToMain?: boolean;
  actions: ItemActions;
}) {
  const href = `${ASSORTMENT_BASE_PATH}/${isBags ? "bags" : "jackets"}/${item.referenceId}`;
  const filled = Boolean(item.idea || item.details.length || item.brief.differences || item.brief.questions || item.nextStep);
  const button = "h-9 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60";
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <Link href={href} className="relative block aspect-[4/5] bg-[#ece9e3]">
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverUrl} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400"><ImageOff className="h-8 w-8" /></div>
        )}
        {label && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-800">{label}</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-2">
        <div>
          <Link href={href} className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 hover:text-violet-800">{item.idea || item.title}</Link>
          <div className="text-xs text-slate-500">{item.idea ? `${item.brand ?? ""} · ${item.title}` : item.brand}</div>
        </div>
        {item.duplicateOf && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Та же конструкция, что «{item.duplicateOf}» — это одна идея
          </div>
        )}
        {item.details.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {item.details.map((d) => <li key={d} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{d}</li>)}
          </ul>
        )}
        {!filled && <p className="text-xs text-slate-500">Задание не заполнено</p>}
        {!archived && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            <button type="button" className={button} disabled={busy !== null} onClick={() => actions.edit(item)}>Задание</button>
            {isBags && (item.isReserve ? canMoveToMain : true) && (
              <button type="button" className={button} disabled={busy !== null} onClick={() => actions.move(item)}>{item.isReserve ? "В основные" : "В резерв"}</button>
            )}
            <button type="button" className={button} disabled={busy !== null} onClick={() => actions.replace(item)}>Заменить</button>
            <button type="button" className={button} disabled={busy !== null} onClick={() => actions.remove(item)}>Убрать</button>
          </div>
        )}
      </div>
    </li>
  );
}

function CandidatePicker({
  collectionId,
  asReserve,
  isBags,
  busy,
  onClose,
  onAdd,
}: {
  collectionId: string;
  asReserve: boolean;
  isBags: boolean;
  busy: string | null;
  onClose: () => void;
  onAdd: (referenceId: string, asReserve: boolean) => void;
}) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; candidates: CandidateCard[] }>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assortment-development/collections/${collectionId}/candidates`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setState({ kind: "error", message: body?.error || `Кандидаты не загрузились (${response.status})` });
        else setState({ kind: "ready", candidates: body.candidates ?? [] });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Нет связи с сервером" }));
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  return (
    <Modal open onClose={onClose} title={asReserve ? "Кандидат в резерв" : "Выбрать кандидата"} size="xl">
      {state.kind === "loading" && <div className="text-sm text-slate-500">Загружаем кандидатов…</div>}
      {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
      {state.kind === "ready" && state.candidates.length === 0 && (
        <p className="text-sm text-slate-600">Свободных кандидатов нет: все находки раздела уже в подборке, отклонены или скрыты. Добавьте новые в ленте.</p>
      )}
      {state.kind === "ready" && state.candidates.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {state.candidates.map((candidate) => (
            <li key={candidate.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200">
              <div className="aspect-[4/5] bg-[#ece9e3]">
                {candidate.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.coverUrl} alt={candidate.title} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400"><ImageOff className="h-6 w-6" /></div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <div className="line-clamp-2 text-xs font-semibold text-slate-900">{candidate.title}</div>
                <div className="text-xs text-slate-500">{candidate.brand}{candidate.status !== "new" && ` · ${STATUS_LABEL[candidate.status]}`}</div>
                <div className="text-xs text-slate-600">{candidate.signal.label}</div>
                {candidate.duplicateOf && <div className="text-xs text-amber-800">Та же конструкция, что «{candidate.duplicateOf}»</div>}
                {candidate.lesson && <div className="text-xs text-amber-800">{candidate.lesson}</div>}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onAdd(candidate.id, asReserve)}
                  className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-violet-700 px-2 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-60"
                >
                  {busy === `add:${candidate.id}` && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                  {isBags && asReserve ? "В резерв" : "Добавить"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function DraftModal({
  collectionId,
  busy,
  onClose,
  onApply,
}: {
  collectionId: string;
  busy: boolean;
  onClose: () => void;
  onApply: (picks: DraftView["picks"]) => void;
}) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; draft: DraftView }>({ kind: "loading" });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/assortment-development/collections/${collectionId}/draft`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setState({ kind: "error", message: body?.error || `Черновик не собрался (${response.status})` });
        else {
          setState({ kind: "ready", draft: body.draft });
          setChosen(new Set((body.draft as DraftView).picks.map((p) => p.id)));
        }
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Нет связи с сервером" }));
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  const picks = state.kind === "ready" ? state.draft.picks.filter((p) => chosen.has(p.id)) : [];
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800">Отмена</button>
      {picks.length > 0 && (
        <button type="button" onClick={() => onApply(picks)} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white disabled:opacity-60">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Добавить выбранные ({picks.length})
        </button>
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Черновик плана" footer={footer} size="lg">
      {state.kind === "loading" && <div className="text-sm text-slate-500">Подбираем разные конструкции…</div>}
      {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
      {state.kind === "ready" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">{state.draft.summary}</p>
          <p className="text-xs text-slate-500">Это предложение: в подборку попадёт только то, что вы отметите.</p>
          {state.draft.picks.length > 0 && (
            <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
              {state.draft.picks.map((pick) => {
                const card = state.draft.cards[pick.id];
                return (
                  <li key={pick.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={chosen.has(pick.id)}
                        onChange={() => setChosen((prev) => {
                          const next = new Set(prev);
                          if (next.has(pick.id)) next.delete(pick.id);
                          else next.add(pick.id);
                          return next;
                        })}
                        className="h-4 w-4 shrink-0 accent-violet-700"
                      />
                      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-md bg-[#ece9e3]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {card?.coverUrl && <img src={card.coverUrl} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">{card?.title ?? pick.id}</div>
                        <div className="text-xs text-slate-500">{card?.brand} · {pick.place === "main" ? "в основные" : "в резерв"} · {card?.signal.label}</div>
                        <div className={`text-xs ${pick.why.startsWith("взята за неимением") ? "text-amber-800" : "text-slate-500"}`}>{pick.why}</div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

function ItemEditor({
  item,
  briefSupported,
  busy,
  onClose,
  onSave,
}: {
  item: CollectionItemView;
  briefSupported: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [idea, setIdea] = useState(item.idea ?? "");
  const [details, setDetails] = useState(item.details.join("\n"));
  const [differences, setDifferences] = useState(item.brief.differences);
  const [questions, setQuestions] = useState(item.brief.questions);
  const [seasonFit, setSeasonFit] = useState(item.brief.season_fit);
  const [nextStep, setNextStep] = useState(item.nextStep ?? "");
  const detailCount = details.split("\n").filter((d) => d.trim()).length;

  const submit = () => {
    const patch: Record<string, unknown> = { idea, details: details.split("\n"), nextStep };
    if (briefSupported) patch.brief = { differences, questions, season_fit: seasonFit };
    onSave(patch);
  };

  const field = "rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500";
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800">Отмена</button>
      <button type="button" onClick={submit} disabled={busy || detailCount > MAX_DETAILS} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white disabled:opacity-60">
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Сохранить
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Задание · ${item.title}`} footer={footer} size="lg">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-slate-600">
          Рабочее название идеи
          <input value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={120} placeholder="Например: мягкий хобо с узлом на ручке" className={`h-11 ${field}`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-slate-600">
          Отличительные детали для изучения — по одной в строке, до {MAX_DETAILS}
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} className={field} />
          {detailCount > MAX_DETAILS && <span className="text-xs text-red-700">Оставьте не больше {MAX_DETAILS} деталей — самые важные.</span>}
        </label>
        {briefSupported && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-slate-600">
              Отличия нашей модели <span className="text-xs text-slate-500">— идея разработки, а не факт о референсе</span>
              <textarea value={differences} onChange={(e) => setDifferences(e.target.value)} rows={3} maxLength={600} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-slate-600">
              Вопросы к образцу
              <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={3} maxLength={600} placeholder="Чем укреплено дно? Какая фурнитура на ремне?" className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-slate-600">
              Сезон и аудитория
              <input value={seasonFit} onChange={(e) => setSeasonFit(e.target.value)} maxLength={300} className={`h-11 ${field}`} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1.5 text-sm text-slate-600">
          Следующий шаг
          <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={300} placeholder="Например: заказать образец-референс, разобрать конструкцию" className={`h-11 ${field}`} />
        </label>
        <p className="text-xs text-slate-500">Цены и деньги в задание не пишем. Задание — для изучения конструкции дизайнером и конструктором, лекала по фото не обещаем.</p>
      </div>
    </Modal>
  );
}

function RemoveModal({
  item,
  replace,
  busy,
  onClose,
  onConfirm,
}: {
  item: CollectionItemView;
  replace: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: ReplaceReason | null) => void;
}) {
  const [reason, setReason] = useState<ReplaceReason | null>(null);
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800">Отмена</button>
      <button
        type="button"
        disabled={busy || (replace && !reason)}
        onClick={() => onConfirm(reason)}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {replace ? "Убрать и выбрать замену" : "Убрать"}
      </button>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={replace ? `Заменить «${item.title}»` : `Убрать «${item.title}»`} footer={footer} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{replace ? "Почему меняем? По причинам учимся, что не предлагать." : "Причина необязательна, но помогает реже предлагать похожее."}</p>
        <div className="flex flex-col gap-1">
          {(Object.keys(REPLACE_REASONS) as ReplaceReason[]).map((key) => (
            <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-800 hover:bg-slate-50">
              <input type="radio" name="replace-reason" checked={reason === key} onChange={() => setReason(key)} className="h-4 w-4 accent-violet-700" />
              {REPLACE_REASONS[key]}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">Модель вернётся в ленту со статусом «Наблюдаем».</p>
      </div>
    </Modal>
  );
}
