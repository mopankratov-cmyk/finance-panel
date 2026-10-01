"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, ImageOff, ImagePlus, Layers, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ASSORTMENT_BASE_PATH, DIRECTION_LABEL, type AssortmentDirection } from "@/lib/assortment/constants";
import { REJECT_REASONS, type ActionId, type RejectReason } from "@/lib/assortment/decisions";
import { GROUP_LABEL, ruDate, type EvidenceGroup } from "@/lib/assortment/evidence";
import type { ModelDetail } from "@/lib/assortment/model";
import { AddToCollectionModal } from "./AddToCollectionModal";
import type { SignalTone } from "@/lib/assortment/signals";
import { sampleLinks } from "@/lib/assortment/whereToBuy";
import { PHOTO_ACCEPT, pickPhotos, uploadPhoto } from "./uploadPhoto";

const TONE: Record<SignalTone, string> = {
  retail: "bg-amber-100 text-amber-900",
  novelty: "bg-violet-100 text-violet-800",
  single: "bg-slate-200 text-slate-700",
  manual: "bg-sky-100 text-sky-900",
};

const GROUPS: EvidenceGroup[] = ["novelty", "spread", "retail"];

type State = { kind: "loading" } | { kind: "error"; message: string; status?: number } | { kind: "ready"; model: ModelDetail };

async function send(url: string, init: RequestInit): Promise<ModelDetail> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error || `Не получилось (${response.status})`), { status: response.status });
  return body.model as ModelDetail;
}

/** Карточка модели: фото, решения, доказательства, признаки, история. */
export function ModelPage({ direction, id }: { direction: AssortmentDirection; id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [photo, setPhoto] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const base = `${ASSORTMENT_BASE_PATH}/${direction}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/assortment-development/references/${id}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState({ kind: "error", message: body?.error || `Карточка не загрузилась (${response.status})`, status: response.status });
        return;
      }
      setState({ kind: "ready", model: body.model });
    } catch {
      setState({ kind: "error", message: "Нет связи с сервером" });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const model = state.kind === "ready" ? state.model : null;

  // Ссылку открыли не из того раздела — ведём в правильный, а не показываем куртку в сумках.
  useEffect(() => {
    if (model && model.direction !== direction) router.replace(`${ASSORTMENT_BASE_PATH}/${model.direction}/${model.id}`);
  }, [model, direction, router]);

  const run = async (label: string, request: () => Promise<ModelDetail>) => {
    setBusy(label);
    setError(null);
    try {
      const next = await request();
      setState({ kind: "ready", model: next });
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError({ message: e instanceof Error ? e.message : "Не получилось", conflict: status === 409 });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const decide = (action: ActionId, extra: Record<string, unknown> = {}) => model && run(action, () =>
    send(`/api/assortment-development/references/${model.id}`, { method: "PATCH", body: JSON.stringify({ action, version: model.version, ...extra }) }));

  const editAttribute = (key: string, edit: Record<string, unknown>) => model && run(`attr:${key}`, () =>
    send(`/api/assortment-development/references/${model.id}`, { method: "PATCH", body: JSON.stringify({ attribute: key, edit, version: model.version }) }))
    .then((ok) => { if (ok) setEditing(null); });

  const addPhotos = async (list: FileList | null) => {
    if (!model) return;
    const picked = pickPhotos([], list);
    if (picked.rejected.length > 0) setError({ message: picked.rejected.join("; "), conflict: false });
    if (picked.files.length === 0) return;
    await run("photos", async () => {
      const uploads: string[] = [];
      for (const file of picked.files) uploads.push(await uploadPhoto(file));
      return send(`/api/assortment-development/references/${model.id}/media`, { method: "POST", body: JSON.stringify({ uploads }) });
    });
  };

  if (state.kind === "loading") return <div className="px-3 py-6 text-sm text-slate-500 sm:px-6">Загружаем карточку…</div>;
  if (state.kind === "error" || !model) {
    return (
      <div className="px-3 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          <Link href={base} className="inline-flex h-10 items-center gap-1.5 self-start text-sm text-violet-700"><ArrowLeft className="h-4 w-4" /> {DIRECTION_LABEL[direction]}</Link>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.kind === "error" ? state.message : "Карточка не загрузилась"}</div>
        </div>
      </div>
    );
  }

  const current = model.media[Math.min(photo, Math.max(model.media.length - 1, 0))];

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Link href={base} className="inline-flex h-10 items-center gap-1.5 self-start text-sm text-violet-700 hover:text-violet-900">
          <ArrowLeft className="h-4 w-4" /> {DIRECTION_LABEL[direction]}
        </Link>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-[#ece9e3]">
              {current?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={current.url} alt={model.title} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                  <ImageOff className="h-10 w-10" />
                  <span className="text-sm">Фото нет — добавьте снимок модели</span>
                </div>
              )}
            </div>
            {model.media.length > 1 && (
              <div className="chip-row flex gap-2">
                {model.media.map((m, index) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPhoto(index)}
                    aria-label={`Фото ${index + 1}`}
                    className={`h-20 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-[#ece9e3] ${index === photo ? "border-violet-600" : "border-transparent"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {m.url && <img src={m.url} alt="" className="h-full w-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>
                Фото: {model.media.length}
                {current && (current.isManual ? " · это фото добавлено вручную" : " · это фото с сайта")}
              </span>
              <label className={`inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50 ${busy === "photos" ? "pointer-events-none opacity-60" : ""}`}>
                {busy === "photos" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                Добавить фото
                <input type="file" accept={PHOTO_ACCEPT.join(",")} multiple className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-sm text-slate-500">
              {[model.brand, model.source?.name && model.source.name !== model.brand ? model.source.name : null, model.region].filter(Boolean).join(" · ")}
            </div>
            <h1 className="text-2xl font-semibold leading-tight text-slate-900 break-anywhere">{model.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE[model.signal.tone]}`}>{model.signal.label}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">Статус: {model.statusLabel}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {model.status !== "rejected" && model.status !== "archived" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setCollecting(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60"
                >
                  <Layers className="h-4 w-4" /> В подборку
                </button>
              )}
              {model.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => (action.needsReason ? setRejecting(true) : void decide(action.id))}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy === action.id && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  {action.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span>{error.message}</span>
                {error.conflict && (
                  <button type="button" onClick={() => { setError(null); void load(); }} className="h-9 rounded-lg border border-red-300 bg-white px-3 text-xs">Обновить карточку</button>
                )}
              </div>
            )}

            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Почему показали</div>
              <p className="mt-1 text-sm leading-6 text-slate-800">{model.signal.why}</p>
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              {model.article && (<><dt className="text-slate-500">Артикул</dt><dd className="break-anywhere text-slate-900">{model.article}</dd></>)}
              {model.url && (
                <>
                  <dt className="text-slate-500">Источник</dt>
                  <dd className="min-w-0">
                    <a href={model.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-violet-700 hover:text-violet-900">
                      <span className="truncate">{model.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </dd>
                </>
              )}
              <dt className="text-slate-500">Впервые у нас</dt><dd className="text-slate-900">{ruDate(model.firstSeenAt)}</dd>
              <dt className="text-slate-500">Последнее подтверждение</dt><dd className="text-slate-900">{ruDate(model.lastSeenAt)}</dd>
            </dl>

            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Где купить образец</div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {sampleLinks(model).map((link) => (
                  <li key={link.label} className="flex flex-wrap items-baseline gap-x-2">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900">
                      {link.label} <ExternalLink className="h-3 w-3" />
                    </a>
                    <span className="text-xs text-slate-500">{link.note}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">Поиск по названию модели. Наличие, доставку в РФ и цену смотрите на сайте — модуль цены не читает.</p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Доказательства</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{GROUP_LABEL[group]}</div>
                <ul className="flex flex-col gap-3">
                  {model.evidence[group].map((row, index) => (
                    <li key={`${row.label}-${index}`} className="text-sm">
                      <div className={row.missing ? "text-slate-500" : "text-slate-900"}>
                        {row.label} — <b className="font-medium">{row.value}</b>
                      </div>
                      <div className="text-xs leading-5 text-slate-500">
                        {row.detail}
                        {row.sourceUrl && (
                          <> · <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:text-violet-900">источник</a></>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Признаки</h2>
            <span className="text-xs text-slate-500">С сайта, от ИИ или вручную — откуда взят каждый, видно справа. Исходное значение при правке сохраняется.</span>
          </div>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {model.attributes.map((row) => (
              <li key={row.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="text-sm text-slate-500 sm:w-48 sm:shrink-0">{row.label}</div>
                {editing?.key === row.key ? (
                  <form
                    className="flex flex-1 flex-wrap items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); void editAttribute(row.key, { kind: "set", value: editing.value }); }}
                  >
                    <input
                      autoFocus
                      value={editing.value}
                      maxLength={120}
                      onChange={(e) => setEditing({ key: row.key, value: e.target.value })}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-violet-500"
                    />
                    <button type="submit" disabled={busy !== null} className="h-10 rounded-lg bg-violet-700 px-3 text-sm text-white disabled:opacity-60">Сохранить</button>
                    <button type="button" disabled={busy !== null} onClick={() => void editAttribute(row.key, { kind: "not_visible" })} className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 disabled:opacity-60">Не видно</button>
                    {row.value !== null && (
                      <button type="button" disabled={busy !== null} onClick={() => void editAttribute(row.key, { kind: "reset" })} className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 disabled:opacity-60">Сбросить</button>
                    )}
                    <button type="button" onClick={() => setEditing(null)} className="h-10 rounded-lg px-3 text-sm text-slate-500">Отмена</button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1 text-sm">
                      <span className={row.value ? "text-slate-900" : "text-slate-400"}>{row.value ?? "—"}</span>
                      <div className="text-xs text-slate-500">
                        {row.origin}
                        {row.previous && <> · было {row.previous}</>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing({ key: row.key, value: row.value && row.value !== "не видно" ? row.value : "" })}
                      className="h-10 self-start rounded-lg border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50 sm:self-auto"
                    >
                      Исправить
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {model.decisions.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-slate-900">История решений</h2>
            <ul className="flex flex-col gap-2">
              {model.decisions.map((d) => (
                <li key={d.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">{d.label}</span>
                    <span className="text-xs text-slate-500">{ruDate(d.createdAt)} · версия {d.version}{d.author && ` · ${d.author}`}</span>
                  </div>
                  {d.reason && <div className="mt-1 text-slate-700">{d.reason}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {collecting && (
        <AddToCollectionModal
          direction={model.direction}
          referenceId={model.id}
          onClose={() => setCollecting(false)}
          onAdded={() => void load()}
        />
      )}

      <RejectModal
        open={rejecting}
        busy={busy === "rejected"}
        onClose={() => setRejecting(false)}
        onSubmit={async (reason, comment) => {
          const ok = await decide("rejected", { reason, comment });
          if (ok) setRejecting(false);
        }}
      />
    </div>
  );
}

function RejectModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: RejectReason, comment: string) => void;
}) {
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [comment, setComment] = useState("");
  const ready = reason !== null && (reason !== "other" || comment.trim().length > 0);
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800">Отмена</button>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => reason && onSubmit(reason, comment)}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
        Отклонить
      </button>
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title="Почему отклоняем" footer={footer} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Причина нужна, чтобы дальше реже показывать похожее.</p>
        <div className="flex flex-col gap-1">
          {(Object.keys(REJECT_REASONS) as RejectReason[]).map((key) => (
            <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-800 hover:bg-slate-50">
              <input type="radio" name="reject-reason" checked={reason === key} onChange={() => setReason(key)} className="h-4 w-4 accent-violet-700" />
              {REJECT_REASONS[key]}
            </label>
          ))}
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder={reason === "other" ? "Напишите причину" : "Комментарий (необязательно)"}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500"
        />
      </div>
    </Modal>
  );
}
