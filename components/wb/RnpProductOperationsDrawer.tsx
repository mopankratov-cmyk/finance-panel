"use client";

import { CalendarDays, Check, History, Loader2, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { WbProductImage } from "./WbProductImage";
import type { RnpTagOption } from "./RnpOperatingToolbar";

export interface RnpJournalEntry {
  id: string;
  nm_id: number;
  event_date: string;
  event_type: string;
  comment: string;
  created_by: string | null;
  created_at: string;
}

interface DrawerSku {
  nm: number;
  art: string;
  name: string;
  img_url: string;
}

interface Props {
  sku: DrawerSku | null;
  tags: RnpTagOption[];
  assignedTagIds: string[];
  journal: RnpJournalEntry[];
  loading: boolean;
  available: boolean;
  message?: string | null;
  onClose: () => void;
  onToggleTag: (tagId: string, assigned: boolean) => Promise<boolean>;
  onAddJournal: (input: { eventDate: string; eventType: string; comment: string }) => Promise<boolean>;
}

const EVENT_TYPES = [
  ["note", "Комментарий"],
  ["price_up", "Цена повышена"],
  ["price_down", "Цена снижена"],
  ["discount_up", "Скидка увеличена"],
  ["discount_down", "Скидка уменьшена"],
  ["promotion_in", "Вход в акцию"],
  ["promotion_out", "Выход из акции"],
  ["ad_budget_up", "Бюджет рекламы повышен"],
  ["ad_budget_down", "Бюджет рекламы снижен"],
  ["ad_on", "Реклама включена"],
  ["ad_off", "Реклама выключена"],
  ["ab_start", "A/B-тест запущен"],
  ["ab_finish", "A/B-тест завершён"],
  ["photo", "Фото обновлено"],
  ["seo", "SEO обновлено"],
  ["supply", "Поставка"],
  ["reviews", "Работа с отзывами"],
] as const;

const EVENT_LABELS = Object.fromEntries(EVENT_TYPES);

function todayIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function RnpProductOperationsDrawer(props: Props) {
  const [eventDate, setEventDate] = useState(todayIso);
  const [eventType, setEventType] = useState("note");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setEventDate(todayIso());
    setEventType("note");
    setComment("");
    setSaving(null);
  }, [props.sku?.nm]);

  if (!props.sku) return null;

  const toggleTag = async (tagId: string, assigned: boolean) => {
    setSaving(`tag:${tagId}`);
    await props.onToggleTag(tagId, assigned);
    setSaving(null);
  };

  const addJournal = async () => {
    setSaving("journal");
    const ok = await props.onAddJournal({ eventDate, eventType, comment });
    if (ok) setComment("");
    setSaving(null);
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/25 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={`Теги и журнал ${props.sku.art}`}>
      <button type="button" className="min-w-0 flex-1 cursor-default" onClick={props.onClose} aria-label="Закрыть панель" />
      <aside className="flex h-full w-full max-w-[430px] flex-col border-l border-slate-200 bg-[#f8fafc] shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start gap-3">
            <WbProductImage nm={props.sku.nm} src={props.sku.img_url} className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 object-cover" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold text-slate-900">{props.sku.art}</h2>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{props.sku.name}</p>
              <p className="mt-1 text-[10px] tabular-nums text-slate-400">WB {props.sku.nm}</p>
            </div>
            <button type="button" onClick={props.onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!props.available ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">
              {props.message || "Общие теги и журнал пока не настроены."}
            </div>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-700"><Tag className="h-4 w-4" /></span>
              <div>
                <h3 className="text-[11px] font-bold text-slate-800">Теги товара</h3>
                <p className="text-[9px] text-slate-400">Общие для всех сотрудников кабинета</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {props.tags.map((tag) => {
                const assigned = props.assignedTagIds.includes(tag.id);
                const pending = saving === `tag:${tag.id}`;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={!props.available || pending}
                    onClick={() => toggleTag(tag.id, !assigned)}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold transition disabled:opacity-50 ${
                      assigned ? "border-slate-400 bg-slate-50 text-slate-800" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                    {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : assigned ? <Check className="h-3 w-3" /> : null}
                  </button>
                );
              })}
              {!props.tags.length ? <span className="text-[10px] text-slate-400">Создайте первый тег в панели над таблицей.</span> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-700"><CalendarDays className="h-4 w-4" /></span>
              <div>
                <h3 className="text-[11px] font-bold text-slate-800">Добавить событие</h3>
                <p className="text-[9px] text-slate-400">Изменение попадёт в хронологию SKU</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[120px_minmax(0,1fr)] gap-2">
              <label>
                <span className="mb-1 block text-[9px] font-semibold text-slate-500">Дата</span>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 px-2 text-[10px] text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-[9px] font-semibold text-slate-500">Тип события</span>
                <select
                  value={eventType}
                  onChange={(event) => setEventType(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  {EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <label className="mt-2 block">
              <span className="mb-1 block text-[9px] font-semibold text-slate-500">Комментарий</span>
              <textarea
                value={comment}
                maxLength={2000}
                rows={3}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Что изменили и зачем — это поможет сопоставить действие с результатом"
                className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] leading-4 text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <button
              type="button"
              disabled={!props.available || saving === "journal" || !eventDate}
              onClick={addJournal}
              className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 text-[10px] font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving === "journal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Сохранить в журнал
            </button>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-600"><History className="h-4 w-4" /></span>
              <div>
                <h3 className="text-[11px] font-bold text-slate-800">История изменений</h3>
                <p className="text-[9px] text-slate-400">{props.journal.length} событий по товару</p>
              </div>
            </div>
            {props.loading ? (
              <div className="mt-4 flex items-center justify-center gap-2 py-6 text-[10px] text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Загружаем журнал
              </div>
            ) : props.journal.length ? (
              <ol className="mt-3 space-y-2">
                {props.journal.map((entry) => (
                  <li key={entry.id} className="relative rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 pl-4">
                    <span className="absolute left-0 top-3 h-5 w-1 rounded-r bg-violet-400" />
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-slate-700">{EVENT_LABELS[entry.event_type] ?? entry.event_type}</span>
                      <time className="text-[9px] tabular-nums text-slate-400">{new Date(`${entry.event_date}T12:00:00`).toLocaleDateString("ru-RU")}</time>
                    </div>
                    {entry.comment ? <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-slate-600">{entry.comment}</p> : null}
                    <p className="mt-1 text-[8px] text-slate-400">{entry.created_by || "Сотрудник"}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-5 text-center text-[10px] text-slate-400">Событий пока нет.</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
