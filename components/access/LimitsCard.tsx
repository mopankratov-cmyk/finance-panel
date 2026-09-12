"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Пороги согласования.
 *
 * До этого экрана их не было вовсе: роут читал и писал значения, склад на них
 * смотрел при списании, а поменять число можно было только запросом руками.
 * Порог, который нельзя увидеть, работает как случайный отказ — человек
 * упирается в «нужна подпись» и не знает, на какой сумме это началось.
 *
 * Область считает сервер по роли: наши видят пороги компании, внешний клиент —
 * свои. Поэтому экран одинаков в обоих контурах и не спрашивает, чьи пороги
 * показывать: спросить значило бы отдать границу клиенту.
 */

interface Limits {
  discrepancyRub: number;
  discrepancyShare: number;
  writeOffPerDocRub: number;
  writeOffPerMonthRub: number;
}

interface Answer {
  limits: Limits;
  defaults: Limits;
  canEdit: boolean;
  scope: "company" | "organization";
}

/** Что именно сторожит каждый порог — словами, а не именем поля. */
const FIELDS: Array<{
  key: keyof Limits;
  title: string;
  explain: string;
  unit: "rub" | "percent";
}> = [
  {
    key: "discrepancyRub",
    title: "Расхождение в приёмке",
    explain: "Дороже этой суммы расхождение принимает не кладовщик, а руководство.",
    unit: "rub",
  },
  {
    key: "discrepancyShare",
    title: "Доля расхождения",
    explain: "Второй порог на ту же приёмку: какую часть поставки можно списать в расхождение без подписи.",
    unit: "percent",
  },
  {
    key: "writeOffPerDocRub",
    title: "Списание за раз",
    explain: "Одно списание дороже этой суммы уходит на согласование.",
    unit: "rub",
  },
  {
    key: "writeOffPerMonthRub",
    title: "Списания за месяц",
    explain: "Сумма всех списаний человека за календарный месяц. Считается нарастающим итогом.",
    unit: "rub",
  },
];

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
const show = (value: number, unit: "rub" | "percent") => (unit === "rub" ? rub(value) : percent(value));

export function LimitsCard() {
  const [data, setData] = useState<Answer | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [absent, setAbsent] = useState(false);

  useEffect(() => {
    fetch("/api/limits", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: Answer) => setData(body))
      // Порогов не видно — карточку не показываем вовсе. Пустая рамка с
      // ошибкой на экране про людей только мешает.
      .catch(() => setAbsent(true));
  }, []);

  const startEdit = () => {
    if (!data) return;
    setDraft(Object.fromEntries(FIELDS.map((field) => [
      field.key,
      field.unit === "percent" ? String(Math.round(data.limits[field.key] * 1000) / 10) : String(Math.round(data.limits[field.key])),
    ])));
    setMsg(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const limits = Object.fromEntries(FIELDS.map((field) => {
      const raw = Number(String(draft[field.key] ?? "").replace(",", "."));
      return [field.key, field.unit === "percent" ? raw / 100 : raw];
    }));
    try {
      const response = await fetch("/api/limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limits }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `Ошибка ${response.status}`);
      setData((prev) => (prev ? { ...prev, limits: body.limits } : prev));
      setEditing(false);
      setMsg({ ok: true, t: "Пороги сохранены" });
    } catch (cause) {
      setMsg({ ok: false, t: cause instanceof Error ? cause.message : "Не удалось сохранить" });
    } finally {
      setSaving(false);
    }
  };

  if (absent) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3">
        <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-700">Пороги согласования</div>
          <div className="text-xs text-gray-400">
            {data?.scope === "organization"
              ? "Пороги вашей организации. Выше них операция ждёт подписи главного пользователя."
              : "Выше этих сумм складская операция ждёт подписи руководства."}
          </div>
        </div>
        {data?.canEdit && !editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Изменить
          </button>
        ) : null}
      </div>

      {!data ? (
        <div className="py-8 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="divide-y divide-gray-100">
          {FIELDS.map((field) => {
            const current = data.limits[field.key];
            const fallback = data.defaults[field.key];
            return (
              <div key={field.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">{field.title}</div>
                  <div className="text-xs leading-5 text-gray-500">{field.explain}</div>
                </div>
                {editing ? (
                  <label className="flex items-center gap-1.5">
                    <input
                      value={draft[field.key] ?? ""}
                      onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      inputMode="decimal"
                      aria-label={field.title}
                      className="min-h-9 w-28 rounded-lg border border-slate-300 px-2 text-right text-sm tabular-nums focus:border-violet-500 focus:outline-none"
                    />
                    <span className="w-4 text-xs text-slate-400">{field.unit === "rub" ? "₽" : "%"}</span>
                  </label>
                ) : (
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-gray-900">{show(current, field.unit)}</div>
                    {/* Отличие от умолчания стоит видеть: иначе непонятно, кто
                        и когда это число подвинул. */}
                    {current !== fallback ? (
                      <div className="text-[11px] text-amber-600">по умолчанию {show(fallback, field.unit)}</div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(editing || msg) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-5 py-3">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setMsg(null); }}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Отмена
              </button>
            </>
          ) : null}
          {msg ? <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.t}</span> : null}
        </div>
      )}
    </div>
  );
}
