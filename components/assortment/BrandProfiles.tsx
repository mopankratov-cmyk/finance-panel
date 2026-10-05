"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DIRECTION_LABEL, type AssortmentDirection } from "@/lib/assortment/constants";
import {
  BRAND_SOURCE_HINTS, SEASONS, profileCompleteness, profileForms, type BrandProfile,
} from "@/lib/assortment/brandProfiles";
import type { FormsReport } from "@/lib/assortment/forms";
import type { OwnModelsReport } from "@/lib/assortment/ownModels";
import { formNumbers, undecidedByDemand, type FormNumbers } from "@/lib/assortment/profileNumbers";
import { plural } from "@/lib/warehouse/plural";
import type { FormDemandReport } from "@/lib/assortment/wbQueries";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profiles: BrandProfile[]; persisted: boolean; canEdit: boolean };

const pctText = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`);
/** Числа формы одной строкой: поиски, каталоги, моделей; без среза спроса — только модели. */
function numbersLine(n: FormNumbers): string {
  const models = `${n.models.toLocaleString("ru-RU")} моделей в каталогах`;
  if (n.demandShare === null && n.supplyShare === null) return models;
  const search = n.inDemandTop ? `поиски ${pctText(n.demandShare)}` : "не в топе поисков";
  return `${search} · каталоги ${pctText(n.supplyShare)} · ${models}${n.concentrated ? " (почти всё у одного источника)" : ""}`;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Экран «Профили брендов»: аудитория, формы, сезоны, палитра — заполняет владелец. */
export function BrandProfiles() {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Числа по формам (доля поисков и доля каталогов) — справка рядом с решениями; сбой чтения профили не роняет.
  const [numbers, setNumbers] = useState<Partial<Record<AssortmentDirection, Map<string, FormNumbers>>>>({});
  // «У нас»: собственные модели бренда на WB по формам (только числа). Нет ответа — строк «у нас» просто нет.
  const [own, setOwn] = useState<Record<string, OwnModelsReport>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assortment-development/brand-profiles")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body?.profiles)) setState({ kind: "error", message: body?.error || `Профили не загрузились (${response.status})` });
        else setState({ kind: "ready", profiles: body.profiles, persisted: Boolean(body.persisted), canEdit: Boolean(body.canEdit) });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Нет связи с сервером" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const directions = state.kind === "ready" ? [...new Set(state.profiles.map((p) => p.direction))].join(",") : "";
  useEffect(() => {
    if (!directions) return;
    let cancelled = false;
    for (const direction of directions.split(",") as AssortmentDirection[]) {
      fetch(`/api/assortment-development/forms?direction=${direction}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (cancelled || !body?.report) return;
          setNumbers((prev) => ({ ...prev, [direction]: formNumbers(body.report as FormsReport, (body.demand as FormDemandReport | null) ?? null) }));
        })
        .catch(() => undefined);
      fetch(`/api/assortment-development/own-models?direction=${direction}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (cancelled || !Array.isArray(body?.own)) return;
          setOwn((prev) => ({ ...prev, ...Object.fromEntries((body.own as OwnModelsReport[]).map((o) => [o.brandKey, o])) }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [directions]);

  return (
    <div className="px-3 pb-16 pt-4 sm:px-6 md:pb-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900">Профили брендов</h1>
          <p className="text-sm text-slate-500">
            Кому, какие формы и в какой сезон делает бренд — решение владельца. Движок ничего сюда не подставляет, а пока поле пустое, не судит, «подходит ли бренду»: это «не решено», а не «подходит».
            HEATON и NORVIA — два профиля; артикул HT- бренд не определяет, бренд берётся из поля бренда на WB.
          </p>
          <p className="text-sm text-slate-500">
            Пока движок использует только решения по формам (они видны на «Формах» у каждой формы). Аудитория, сезоны и палитра нигде не используются — это записи для вас и команды.
          </p>
        </header>
        {state.kind === "loading" && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Загружаем профили…</div>}
        {state.kind === "error" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</div>}
        {state.kind === "ready" && !state.persisted && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            Профили пока не сохраняются: нужно применить миграцию 202610050004_assortment_brand_profile.sql. Ниже — пустые черновики.
          </div>
        )}
        {state.kind === "ready" && state.profiles.map((profile) => (
          <ProfileCard key={`${profile.brandKey}:${profile.version}`} profile={profile} editable={state.canEdit && state.persisted} numbers={numbers[profile.direction]} own={own[profile.brandKey]} />
        ))}
      </div>
    </div>
  );
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export function ProfileCard({ profile, editable, numbers, own }: { profile: BrandProfile; editable: boolean; numbers?: Map<string, FormNumbers>; own?: OwnModelsReport }) {
  const [saved, setSaved] = useState(profile);
  const [audience, setAudience] = useState(profile.audience ?? "");
  const [fit, setFit] = useState(profile.fitForms);
  const [avoid, setAvoid] = useState(profile.avoidForms);
  const [seasons, setSeasons] = useState(profile.seasons);
  const [palette, setPalette] = useState(profile.palette ?? "");
  const [notes, setNotes] = useState(profile.notes ?? "");
  const [sourceRef, setSourceRef] = useState(profile.sourceRef ?? "");
  const [confirmed, setConfirmed] = useState(profile.status === "confirmed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forms = useMemo(() => profileForms(profile.direction), [profile.direction]);
  // «Не решено» считаем по тому, что на экране сейчас (включая несохранённые отметки), а не по сохранённой версии.
  const undecided = useMemo(() => (numbers ? undecidedByDemand({ fitForms: fit, avoidForms: avoid }, numbers) : []), [numbers, fit, avoid]);
  const hints = BRAND_SOURCE_HINTS[profile.brandKey] ?? [];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));
  const dirty = audience !== (saved.audience ?? "") || !same(fit, saved.fitForms) || !same(avoid, saved.avoidForms) || !same(seasons, saved.seasons)
    || palette !== (saved.palette ?? "") || notes !== (saved.notes ?? "") || sourceRef !== (saved.sourceRef ?? "") || confirmed !== (saved.status === "confirmed");
  const completeness = profileCompleteness({ audience: audience.trim() || null, fitForms: fit, avoidForms: avoid, seasons, palette: palette.trim() || null });

  const setForm = (key: string, to: "fit" | "avoid" | "none") => {
    setFit((prev) => (to === "fit" ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)));
    setAvoid((prev) => (to === "avoid" ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/assortment-development/brand-profiles/${profile.brandKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, fitForms: fit, avoidForms: avoid, seasons, palette, notes, sourceRef, confirmed, version: saved.version }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.profile) throw new Error(body?.error || `Не сохранилось (${response.status})`);
      const next = body.profile as BrandProfile;
      setSaved(next);
      // Сервер приводит пробелы и порядок к своему виду — показываем сохранённое, иначе «есть несохранённые правки» не гаснет.
      setAudience(next.audience ?? "");
      setFit(next.fitForms);
      setAvoid(next.avoidForms);
      setSeasons(next.seasons);
      setPalette(next.palette ?? "");
      setNotes(next.notes ?? "");
      setSourceRef(next.sourceRef ?? "");
      setConfirmed(next.status === "confirmed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{profile.displayName} <span className="text-sm font-normal text-slate-500">· {DIRECTION_LABEL[profile.direction]}</span></h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {saved.status === "confirmed" && saved.confirmedAt
            ? <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-800">Подтверждён {dmy(saved.confirmedAt)}</span>
            : <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">Черновик</span>}
          <span className="text-slate-500">заполнено {completeness.filled} из {completeness.total}{completeness.missing.length > 0 ? ` · не решено: ${completeness.missing.join(", ")}` : ""}</span>
        </div>
      </div>

      {hints.length > 0 && (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <div className="font-medium text-slate-700">Что известно из заметок проекта (не подтверждено, в профиль не внесено)</div>
          <ul className="mt-1 list-disc pl-4">{hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-800">Аудитория</span>
        <textarea value={audience} onChange={(e) => setAudience(e.target.value)} readOnly={!editable} rows={2} maxLength={1000} placeholder="Кому делаем: пол, возраст, образ жизни" className="rounded-lg border border-slate-300 px-3 py-2 text-sm read-only:bg-slate-50" />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-800">Формы</legend>
        <p className="text-xs text-slate-500">Что бренду подходит, а что нет. Не отмеченное — «не решено».</p>
        {own && !own.found && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Карточек с брендом «{profile.wbBrandNames.join(" / ")}» в базе WB не нашлось — «у нас» не проверено (не «0»): проверьте, под каким названием бренда заведены карточки и подключён ли кабинет.
          </p>
        )}
        {own && own.found && (
          <p className="text-xs leading-5 text-slate-500">
            У нас на WB: {own.models.toLocaleString("ru-RU")} {plural(own.models, "модель", "модели", "моделей")} ({own.cards.toLocaleString("ru-RU")} {plural(own.cards, "карточка", "карточки", "карточек")}); форма — по названию карточки, не по фото.
            {own.unrecognized > 0 ? ` У ${own.unrecognized.toLocaleString("ru-RU")} название формы не называет.` : ""}
          </p>
        )}
        {undecided.length > 0 && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
            Не решено по формам с самым большим спросом на WB: {undecided.map((n) => `${n.label} (${pctText(n.demandShare)} поисков)`).join(", ")}.
            Спрос — справка, а не вывод: «ищут много» не значит «подходит бренду», это решаете вы.
          </p>
        )}
        <div className="flex flex-col divide-y divide-slate-100">
          {forms.map((form) => {
            const value = fit.includes(form.key) ? "fit" : avoid.includes(form.key) ? "avoid" : "none";
            const n = numbers?.get(form.key);
            return (
              <div key={form.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm text-slate-800">{form.label}</span>
                  {(n || (own && own.found)) && <span className="text-xs text-slate-500">{[n ? numbersLine(n) : null, own && own.found ? `у нас ${(own.byForm[form.key] ?? 0).toLocaleString("ru-RU")} ${plural(own.byForm[form.key] ?? 0, "модель", "модели", "моделей")}` : null].filter(Boolean).join(" · ")}</span>}
                </span>
                {editable ? (
                  <div role="radiogroup" aria-label={form.label} className="flex gap-1">
                    {([["fit", "Подходит"], ["none", "Не решено"], ["avoid", "Не подходит"]] as const).map(([option, label]) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={value === option}
                        onClick={() => setForm(form.key, option)}
                        className={`h-10 rounded-full px-3 text-xs ${value === option
                          ? option === "fit" ? "bg-green-700 font-medium text-white" : option === "avoid" ? "bg-red-700 font-medium text-white" : "bg-slate-200 font-medium text-slate-700"
                          : "border border-slate-200 bg-white text-slate-600"} hover:bg-slate-50`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  // Править может директор; остальным — решение текстом, а не три отключённые кнопки.
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${value === "fit" ? "bg-green-50 text-green-800" : value === "avoid" ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-600"}`}>
                    {value === "fit" ? "Подходит" : value === "avoid" ? "Не подходит" : "Не решено"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-800">Сезоны</legend>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            {SEASONS.map((season) => {
              const on = seasons.includes(season.key);
              return (
                <button
                  key={season.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSeasons((prev) => toggle(prev, season.key))}
                  className={`h-10 rounded-full px-4 text-sm ${on ? "bg-violet-700 font-medium text-white" : "border border-slate-300 bg-white text-slate-700"} hover:opacity-90`}
                >
                  {season.label}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-700">{seasons.length > 0 ? SEASONS.filter((x) => seasons.includes(x.key)).map((x) => x.label).join(", ") : "Не решено"}</p>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-800">Палитра</span>
          <input value={palette} onChange={(e) => setPalette(e.target.value)} readOnly={!editable} maxLength={300} placeholder="Основные цвета бренда" className="h-10 rounded-lg border border-slate-300 px-3 text-sm read-only:bg-slate-50" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-800">Откуда это известно</span>
          <input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} readOnly={!editable} maxLength={300} placeholder="Брендбук, решение, дата" className="h-10 rounded-lg border border-slate-300 px-3 text-sm read-only:bg-slate-50" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-800">Заметки</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={!editable} rows={2} maxLength={1000} className="rounded-lg border border-slate-300 px-3 py-2 text-sm read-only:bg-slate-50" />
      </label>

      {editable && (
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4" />
          Подтверждаю профиль как владелец
        </label>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {editable && dirty && (
        <div>
          <button type="button" onClick={save} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-lg bg-violet-700 px-5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Сохранить профиль
          </button>
        </div>
      )}
    </section>
  );
}
