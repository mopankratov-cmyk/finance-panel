"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import { ACCURACY_MIN_JUDGED, ACCURACY_UNCLEAR_MAX, accuracyLabel, hiddenReason, type FieldAccuracy, type Verdict } from "@/lib/assortment/attributeVerdicts";
import { ATTRIBUTE_FIELDS } from "@/lib/assortment/attributes";
import { MIN_SOURCE_MODELS } from "@/lib/assortment/forms";
import {
  AVERAGE_MIN_COVERAGE, isJudgeableField, MIN_MODELS_FOR_TRAITS, MIN_SOURCE_VISIBLE, MIN_SOURCES_FOR_FIELD_AVERAGE, MIN_VISIBLE_FOR_SHARES, photoSkipKey, PRELIMINARY_COVERAGE, PROMPT_VERSION, sourceGaps,
  type PhotoTraitsReport, type SourceShare,
} from "@/lib/assortment/catalogAi";
import type { PhotoSample } from "@/lib/assortment/catalogAiStore";
import { plural } from "@/lib/warehouse/plural";

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;

/**
 * Признаки каталога по фото — оценка ИИ. Доли прячутся, пока разобрано меньше
 * MIN_MODELS_FOR_TRAITS моделей: по горстке моделей они ничего не значат. А примеры
 * разбора (фото рядом с тем, что написал ИИ) видны сразу, с первой разобранной модели:
 * сверить описание с картинкой можно и на десяти.
 */
export function PhotoTraits({ direction }: { direction: AssortmentDirection }) {
  const [report, setReport] = useState<PhotoTraitsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Точность, измеренная человеком: loading — ещё грузится (доли не показываем: они могли бы мигнуть и пропасть); none — таблицы отметок
  // нет (строк про точность тогда не показываем); error — прочитать не удалось (доли показываем, но говорим, что проверки точностью нет).
  const [accuracyState, setAccuracyState] = useState<AccuracyState>({ kind: "loading" });
  const directionRef = useRef(direction);
  directionRef.current = direction;
  // Номер запроса точности: после серии быстрых отметок ответы могут прийти не по порядку — применяется только последний.
  const accuracySeq = useRef(0);

  const loadAccuracy = useCallback(() => {
    const forDirection = direction;
    const seq = (accuracySeq.current += 1);
    fetch(`/api/assortment-development/photo-traits?direction=${direction}&accuracy=1`, { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body || typeof body !== "object" || !("accuracy" in body)) throw new Error("accuracy");
        return body as { accuracy: Record<string, FieldAccuracy> | null; accuracyModel?: string | null; otherModels?: OtherAccuracy[] };
      })
      .then((body) => {
        if (directionRef.current !== forDirection || accuracySeq.current !== seq) return;
        setAccuracyState(body.accuracy ? { kind: "ready", byField: body.accuracy, model: body.accuracyModel ?? null, others: Array.isArray(body.otherModels) ? body.otherModels : [] } : { kind: "none" });
      })
      // Сбой обновления после отметки не стирает уже прочитанную точность: она устарела на одну отметку, но не пропала.
      .catch(() => {
        if (directionRef.current === forDirection && accuracySeq.current === seq) setAccuracyState((cur) => (cur.kind === "ready" ? cur : { kind: "error" }));
      });
  }, [direction]);

  useEffect(() => {
    setAccuracyState({ kind: "loading" });
    loadAccuracy();
  }, [loadAccuracy]);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    fetch(`/api/assortment-development/photo-traits?direction=${direction}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body?.error || `Не загрузилось (${response.status})`);
        else if (body?.report) setReport(body.report as PhotoTraitsReport);
      })
      .catch(() => {
        if (!cancelled) setError("Нет связи с сервером");
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  // Сбой чтения не прячем: молчание выглядело бы как «разбора нет». Пока ничего не разобрано (report пуст) — блока нет.
  if (error) return <PhotoTraitsError message={error} />;
  if (!report) return null;
  const ready = report.analyzed >= MIN_MODELS_FOR_TRAITS && report.fields.length > 0;
  const accuracy = accuracyState.kind === "ready" ? accuracyState.byField : accuracyState.kind === "none" ? null : undefined;
  const accuracyModel = accuracyState.kind === "ready" ? accuracyState.model : null;
  const otherAccuracy = accuracyState.kind === "ready" ? accuracyState.others : [];

  return (
    <div className="flex flex-col gap-4">
      {ready ? (accuracyState.kind === "loading" ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">Признаки по фото: проверяем, какие признаки разобраны достаточно точно…</p>
      ) : <TraitsSection report={report} accuracy={accuracy} accuracyModel={accuracyModel} otherAccuracy={otherAccuracy} accuracyFailed={accuracyState.kind === "error"} />) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
          Признаки по фото: разобрано {num(report.analyzed)} из {num(report.catalog)} {plural(report.catalog, "модели", "моделей", "моделей")} с фото. Доли по признакам появятся, когда разобрано будет хотя бы {MIN_MODELS_FOR_TRAITS}; а как ИИ описывает фото, можно посмотреть уже сейчас — на примерах ниже.
          {(report.legacy ?? 0) > 0 && ` Ещё ${num(report.legacy)} ${plural(report.legacy, "модель разобрана", "модели разобраны", "моделей разобрано")} по прежнему вопросу: в долях они не участвуют и пересоберутся.`}
        </p>
      )}
      <PhotoSamples direction={direction} accuracy={accuracy} accuracyModel={accuracyModel} otherAccuracy={otherAccuracy} accuracyFailed={accuracyState.kind === "error"} onJudged={loadAccuracy} />
    </div>
  );
}

/** Точность разборов прежней моделью ИИ той же версии вопроса: отдельно, в точность текущей модели не входит. */
export interface OtherAccuracy {
  aiModel: string | null;
  marks: number;
  byField: Record<string, FieldAccuracy>;
}

type AccuracyState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "ready"; byField: Record<string, FieldAccuracy>; model: string | null; others: OtherAccuracy[] };

const modelName = (aiModel: string | null) => (aiModel ? `«${aiModel}»` : "без записанного имени");

/**
 * Причина спрятать доли признака: низкая точность у текущей модели ИИ — или у прежней модели той же версии вопроса: её разборы
 * пересобираются только при смене вопроса, так что они ещё в долях, и низкая точность прежней модели портит доли так же.
 */
export function fieldHiddenReason(key: string, accuracy: Record<string, FieldAccuracy> | null | undefined, others: OtherAccuracy[] = []): string | null {
  if (!accuracy || !isJudgeableField(key)) return null;
  const own = hiddenReason(accuracy[key]);
  if (own) return own;
  for (const other of others) {
    const reason = hiddenReason(other.byField[key]);
    if (reason) return `у прежней модели ИИ ${modelName(other.aiModel)} (её разборы этой версии вопроса тоже в долях) ${reason}`;
  }
  return null;
}

const MAX_GAP_NAMES = 6;
const listNames = (items: string[]) => `${items.slice(0, MAX_GAP_NAMES).join(", ")}${items.length > MAX_GAP_NAMES ? ` и ещё ${items.length - MAX_GAP_NAMES}` : ""}`;

/**
 * Подпись «каких источников в долях нет или мало»: охват считается от моделей с фото без сайтов РФ, и «90%» иначе прятал бы, что
 * Zara (живые фото — у трети моделей) и сайты РФ в долях почти не представлены. null — все источники представлены.
 */
export function sourceGapsNote(sources: SourceShare[] | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  const { absent, few } = sourceGaps(sources);
  if (absent.length === 0 && few.length === 0) return null;
  const why = (s: SourceShare) => (s.ru ? "сайт РФ — ориентир, ИИ его не разбирает" : s.eligible === 0 ? "нет ссылок на фото" : `ещё не разобран, с фото ${num(s.eligible)}`);
  const parts: string[] = [];
  if (absent.length > 0) parts.push(`нет — ${listNames(absent.map((s) => `${s.name} (${why(s)})`))}`);
  if (few.length > 0) {
    parts.push(`мало — ${listNames(few.map((s) => {
      const noPhoto = s.models - s.eligible;
      return `${s.name}: ${num(s.analyzed)} из ${num(s.models)}${noPhoto > 0 ? `, у ${num(noPhoto)} нет ссылок на фото` : ""}`;
    }))}`);
  }
  return `Каких источников в долях нет или мало: ${parts.join("; ")}. Доли описывают остальные источники, а не весь рынок раздела.`;
}

/** Признаки по фото не загрузились — говорим об этом, а не молчим. */
export function PhotoTraitsError({ message }: { message: string }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Признаки по фото не загрузились: {message}.</p>;
}

export function TraitsSection({ report, accuracy, accuracyModel, otherAccuracy = [], accuracyFailed }: {
  report: PhotoTraitsReport;
  accuracy?: Record<string, FieldAccuracy> | null;
  /** Модель ИИ, чья точность показана (та, что сейчас пишет разбор). */
  accuracyModel?: string | null;
  /** Точность прежних моделей ИИ той же версии вопроса — отдельно. */
  otherAccuracy?: OtherAccuracy[];
  accuracyFailed?: boolean;
}) {
  const gaps = sourceGapsNote(report.sources);
  return (
    <section aria-label="Признаки по фото" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Признаки по фото — оценка ИИ
          {report.coverage < PRELIMINARY_COVERAGE && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-normal text-amber-800">предварительно</span>}
        </h2>
        <span className="text-xs text-slate-500">
          разобрано {num(report.analyzed)} из {num(report.catalog)} {plural(report.catalog, "модели", "моделей", "моделей")} с фото ({pct(report.coverage)})
        </span>
      </div>
      {accuracyFailed && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Точность разбора не загрузилась: доли ниже показаны без проверки по отметкам человека — возможно, у части признаков она низкая. Обновите страницу.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {report.fields.map((field) => {
          const shown = field.values.slice(0, 5);
          const other = field.other;
          // Модели в значениях за пятой строкой: без этой строки полоски и «другие формулировки» не сходятся к «видно у N».
          const hidden = Math.max(0, field.visible - shown.reduce((sum, v) => sum + v.models, 0) - (other?.models ?? 0));
          const examples = (other?.examples ?? []).map((e) => `«${e.text}»${e.models > 1 ? ` ×${e.models}` : ""}`).join(", ");
          const unshown = [
            hidden > 0 ? `редкие значения — ${num(hidden)} ${plural(hidden, "модель", "модели", "моделей")}` : null,
            other ? `другие формулировки — ${num(other.models)} ${plural(other.models, "модель", "модели", "моделей")}${examples ? ` (${examples})` : ""}` : null,
          ].filter(Boolean);
          const tooFew = field.visible < MIN_VISIBLE_FOR_SHARES;
          // Точность этого признака, измеренная человеком: строка про неё есть, только когда отметки вообще заведены (accuracy не null).
          const judgeable = isJudgeableField(field.key);
          const measured = accuracy && judgeable ? accuracy[field.key] : undefined;
          const unreliable = fieldHiddenReason(field.key, accuracy, otherAccuracy);
          const base = (v: (typeof shown)[number]) => v.avgSourceShare ?? v.share;
          return (
            <div key={field.key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{field.label}</span>
                <span className="text-xs text-slate-500">видно у {num(field.visible)} · не видно {num(field.notVisible)}</span>
              </div>
              {report.basis === "averaged" && field.basis === "raw" && <p className="mt-1 text-xs leading-5 text-slate-500">Доли — по всем моделям, где признак виден: источников, где он виден хотя бы у {MIN_SOURCE_VISIBLE} моделей, меньше {MIN_SOURCES_FOR_FIELD_AVERAGE}, средней по источникам нет.</p>}
              {accuracy && judgeable && <p className={`mt-1 text-xs leading-5 ${unreliable ? "text-amber-800" : "text-slate-500"}`}>Точность разбора: {accuracyLabel(measured)}.</p>}
              {unreliable ? (
                <p className="mt-2 text-xs leading-5 text-amber-800">Доли не показываем: {unreliable}. Скажите — поправим вопрос или словарь и разберём заново.</p>
              ) : tooFew ? (
                <p className="mt-2 text-xs leading-5 text-slate-500">Мало данных: признак виден у {num(field.visible)} {plural(field.visible, "модели", "моделей", "моделей")}, доли покажем, когда будет {MIN_VISIBLE_FOR_SHARES} и больше.</p>
              ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {shown.map((v) => (
                  <li key={v.value} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm text-slate-800">
                      <span className="break-anywhere">{v.value}</span>
                      <span className="shrink-0 text-xs text-slate-600">{pct(base(v))} <span className="text-slate-400">· {num(v.models)}</span></span>
                    </div>
                    <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(1, base(v)))}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
              )}
              {!tooFew && !unreliable && unshown.length > 0 && <p className="mt-2 text-xs text-slate-500">Не показано: {unshown.join("; ")}.</p>}
            </div>
          );
        })}
      </div>
      {gaps && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{gaps}</p>}
      <p className="text-xs leading-5 text-slate-500">
        Это оценка ИИ по фото модели (до двух), а не факт с сайта и не ручная проверка: что на фото не видно, ИИ не угадывает, и такие модели в долях признака не участвуют.
        Полоска — доля от 100%, а не от самого частого значения. {report.basis === "averaged"
          ? `Доля — средняя по источникам (учтено ${report.sourcesInAverage}, у каждого не меньше ${MIN_SOURCE_MODELS} разобранных моделей; вместе они дают ${Math.round(report.averageCoverage * 100)}% разобранного): большой каталог не решает за остальные.`
          : `Пока разобрано мало: источников с ${MIN_SOURCE_MODELS} и более разобранными моделями недостаточно, чтобы усреднять, поэтому доли — по всем разобранным моделям и зависят от того, какие источники успели разобраться; средняя по источникам включится, когда такие источники будут давать ${Math.round(AVERAGE_MIN_COVERAGE * 100)}% разобранного.`}
        {" "}Пока разобрана не вся витрина, картина может сместиться.
        {accuracy && ` Точность каждого признака — расчёт по отметкам человека «верно / неверно» в блоке проверки ниже (нижняя граница 95% интервала Уилсона)${accuracyModel ? ` по разборам модели ИИ ${modelName(accuracyModel)}, которая сейчас пишет разбор` : ""}: пока по признаку размечено меньше ${ACCURACY_MIN_JUDGED}, она не считается измеренной; «не понять» в неё не входит, но если таких отметок больше ${Math.round(ACCURACY_UNCLEAR_MAX * 100)}% (при ${ACCURACY_MIN_JUDGED} и более отметках), признак по фото не проверить и доли прячутся.`}
        {accuracy && otherAccuracy.length > 0 && ` Отметки разборов прежней моделью ИИ (${otherAccuracy.map((o) => `${modelName(o.aiModel)} — ${num(o.marks)}`).join(", ")}) в эту точность не входят: у каждой модели своя.`}
        {(report.legacy ?? 0) > 0 && ` Ещё ${num(report.legacy)} ${plural(report.legacy, "модель разобрана", "модели разобраны", "моделей разобрано")} по прежнему вопросу: в долях они не участвуют и пересоберутся.`}
        {" "}Цен нет.
      </p>
    </section>
  );
}

type SamplesState =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; samples: PhotoSample[]; analyzed: number; judging: boolean; verdictsAvailable: boolean; judgedModels: number; unjudgedModels: number; otherModelUnjudged: number; photoUnavailable: number };

/** Сколько моделей «фото у меня не открылось» помнить и отдавать серверу (адрес запроса: 8 знаков на модель; сервер берёт до 500). */
export const PHOTO_SKIP_KEEP = 300;
const photoSkipStorageKey = (direction: AssortmentDirection) => `assortment:photo-skip:${direction}`;

/** Хранилище браузера, если оно доступно (в приватном окне и при заблокированных данных сайта доступ бросает исключение). */
function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Модели раздела, чьё фото у этого зрителя не открылось (короткие ключи photoSkipKey), — из хранилища браузера: после перезагрузки
 * страницы они не возвращаются в «Следующие 12 без отметок». Удобство одного зрителя; хранилища нет или в нём мусор — пустой набор.
 */
export function readPhotoSkips(storage: Pick<Storage, "getItem"> | null | undefined, direction: AssortmentDirection): Set<string> {
  try {
    const raw = storage?.getItem(photoSkipStorageKey(direction));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string" && /^[0-9a-f]{8}$/.test(k)).slice(-PHOTO_SKIP_KEEP) : []);
  } catch {
    return new Set();
  }
}

/** Запомнить набор в хранилище браузера (последние PHOTO_SKIP_KEEP); не записалось — экран работает и без этого, до перезагрузки. */
export function rememberPhotoSkips(storage: Pick<Storage, "setItem"> | null | undefined, direction: AssortmentDirection, keys: ReadonlySet<string>): void {
  try {
    storage?.setItem(photoSkipStorageKey(direction), JSON.stringify([...keys].slice(-PHOTO_SKIP_KEEP)));
  } catch {
    // Хранилище недоступно или переполнено — помним только в открытой вкладке.
  }
}

/** Ключ отметки в карточке: модель + признак. По нему кнопки блокируются на время сохранения и под ним показывается сбой. */
export const verdictKey = (sample: Pick<PhotoSample, "sourceId" | "modelKey">, field: string) => `${sample.sourceId}:${sample.modelKey}:${field}`;

/**
 * Примеры разбора: модель — фото, название и то, что про неё написал ИИ. Сверить с картинкой. Второй режим — разметка:
 * следующие модели без отметок и кнопки «верно / неверно / не понять» по каждому признаку; из отметок складывается точность
 * (она видна в карточках признаков выше), и доли признака с низкой точностью прячутся.
 */
function PhotoSamples({ direction, accuracy, accuracyModel, otherAccuracy, accuracyFailed, onJudged }: {
  direction: AssortmentDirection;
  accuracy?: Record<string, FieldAccuracy> | null;
  accuracyModel?: string | null;
  otherAccuracy?: OtherAccuracy[];
  accuracyFailed?: boolean;
  onJudged?: () => void;
}) {
  const [state, setState] = useState<SamplesState>({ kind: "closed" });
  // Модели, чьё фото у этого человека не открылось (короткие ключи): следующая выборка «без отметок» их не предлагает — отметить нечем,
  // а иначе они вставали бы в каждую следующую дюжину. Помнятся в браузере (readPhotoSkips): сервер о них знать не может — у ИИ это фото
  // скачалось, не открывается оно только у зрителя (сайты, закрытые из РФ), — и после перезагрузки они иначе вернулись бы в разметку.
  const failedPhotos = useRef<Set<string>>(new Set());
  // Сохраняется каждая отметка отдельно: пока уходит одна, остальные кнопки рабочие (молча проглоченный клик = потерянная отметка).
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [verdictErrors, setVerdictErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setState({ kind: "closed" });
    failedPhotos.current = readPhotoSkips(browserStorage(), direction);
  }, [direction]);
  const onPhotoFailed = useCallback((sample: PhotoSample) => {
    if (!sample.modelKey) return;
    const key = photoSkipKey(sample.sourceId, sample.modelKey);
    if (failedPhotos.current.has(key)) return;
    failedPhotos.current.add(key);
    rememberPhotoSkips(browserStorage(), direction, failedPhotos.current);
  }, [direction]);

  const load = (judging: boolean) => {
    // Следующие карточки берутся по отметкам из базы: пока хоть одна не дошла, выборка могла бы вернуть уже размеченную модель.
    if (busyKeys.size > 0) return;
    setState({ kind: "loading" });
    setVerdictErrors({});
    const seed = Math.random().toString(36).slice(2, 10);
    const skip = judging && failedPhotos.current.size > 0 ? `&skip=${[...failedPhotos.current].slice(-PHOTO_SKIP_KEEP).join(",")}` : "";
    fetch(`/api/assortment-development/photo-traits?direction=${direction}&samples=1&seed=${seed}&limit=12${judging ? "&unjudged=1" : ""}${skip}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body?.result) setState({ kind: "error", message: body?.error || `Примеры не загрузились (${r.status})` });
        else setState({ kind: "ready", samples: body.result.samples as PhotoSample[], analyzed: Number(body.result.analyzed) || 0, judging, verdictsAvailable: Boolean(body.result.verdictsAvailable), judgedModels: Number(body.result.judgedModels) || 0, unjudgedModels: Number(body.result.unjudgedModels) || 0, otherModelUnjudged: Number(body.result.otherModelUnjudged) || 0, photoUnavailable: Number(body.result.photoUnavailable) || 0 });
      })
      .catch(() => setState({ kind: "error", message: "Нет связи с сервером" }));
  };

  const judge = async (sample: PhotoSample, field: string, verdict: Verdict | null) => {
    if (state.kind !== "ready" || !sample.modelKey) return;
    const key = verdictKey(sample, field);
    if (busyKeys.has(key)) return;
    const patch = (next: Verdict | null) => setState((cur) => (cur.kind !== "ready" ? cur : {
      ...cur,
      samples: cur.samples.map((x) => {
        if (x.sourceId !== sample.sourceId || x.modelKey !== sample.modelKey) return x;
        const verdicts = { ...(x.verdicts ?? {}) };
        if (next === null) delete verdicts[field];
        else verdicts[field] = next;
        return { ...x, verdicts };
      }),
    }));
    const before = sample.verdicts?.[field] ?? null;
    setBusyKeys((cur) => new Set(cur).add(key));
    setVerdictErrors((cur) => {
      const { [key]: _removed, ...rest } = cur;
      return rest;
    });
    patch(verdict);
    try {
      const response = await fetch("/api/assortment-development/photo-traits/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, sourceId: sample.sourceId, modelKey: sample.modelKey, field, verdict }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Не сохранилось (${response.status})`);
      onJudged?.();
    } catch (e) {
      patch(before);
      setVerdictErrors((cur) => ({ ...cur, [key]: e instanceof Error ? e.message : "Не сохранилось" }));
    } finally {
      setBusyKeys((cur) => {
        const next = new Set(cur);
        next.delete(key);
        return next;
      });
    }
  };

  const ready = state.kind === "ready" ? state : null;
  const judging = ready?.judging && ready.verdictsAvailable;
  const saving = busyKeys.size > 0;
  return (
    <section aria-label="Проверка разбора" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Проверить разбор на примерах</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => load(false)} disabled={state.kind === "loading" || saving} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60">
            {ready && !ready.judging ? "Другие примеры" : state.kind === "loading" ? "Загружаем…" : "Показать 12 случайных моделей"}
          </button>
          <button type="button" onClick={() => load(true)} disabled={state.kind === "loading" || saving} className="h-10 rounded-lg bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
            {saving ? "Сохраняем отметку…" : ready?.judging ? "Следующие 12 без отметок" : "Разметить точность"}
          </button>
        </div>
      </div>
      {state.kind === "closed" && <p className="text-xs leading-5 text-slate-500">Фото рядом с тем, что написал ИИ: так видно, где он ошибается, прежде чем верить долям выше. Выборка идёт по кругу между источниками. «Разметить точность» — те же карточки с кнопками «верно / неверно / не понять» по каждому признаку: из отметок складывается точность разбора.</p>}
      {state.kind === "error" && <p className="text-sm text-amber-800">{state.message}</p>}
      {ready && ready.judging && !ready.verdictsAvailable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Отметки точности заработают после применения миграции 202610050007_assortment_attribute_verdict.sql. Пока можно только смотреть примеры.</p>
      )}
      {ready && ready.samples.length === 0 && (
        <p className="text-sm text-slate-600">
          {ready.judging ? "Размечать больше нечего: у всех моделей, разобранных по текущему вопросу, отмечены все признаки (или таких моделей ещё нет — разбор по прежнему вопросу пересоберётся)." : "Пока нечего показывать: разобранных моделей из текущего каталога нет."}
          {ready.judging && ready.photoUnavailable > 0 && ` Ещё ${num(ready.photoUnavailable)} ${plural(ready.photoUnavailable, "модель", "модели", "моделей")} с неотмеченными признаками не выдаём: фото недоступно — отметить нечем.`}
        </p>
      )}
      {ready && ready.samples.length > 0 && (
        <>
          {judging && <AccuracySummary direction={direction} accuracy={accuracy} accuracyModel={accuracyModel} otherAccuracy={otherAccuracy} accuracyFailed={accuracyFailed} judgedModels={ready.judgedModels} unjudgedModels={ready.unjudgedModels} otherModelUnjudged={ready.otherModelUnjudged} photoUnavailable={ready.photoUnavailable} />}
          <SampleCards samples={ready.samples} judging={judging ? { currentVersion: PROMPT_VERSION, busyKeys, errors: verdictErrors, onVerdict: judge } : undefined} onPhotoFailed={onPhotoFailed} />
          <p className="text-xs leading-5 text-slate-500">Из {num(ready.analyzed)} разобранных. Это оценка ИИ по фото: она ошибается, «не видно» — честный ответ, а не пропуск. Если неверно слишком часто, скажите — поправим вопрос или модель.</p>
        </>
      )}
    </section>
  );
}

/** Точность по признакам одной строкой каждая — что уже размечено и сколько ещё нужно. */
export function AccuracySummary({ direction, accuracy, accuracyModel, otherAccuracy = [], accuracyFailed, judgedModels, unjudgedModels, otherModelUnjudged = 0, photoUnavailable = 0 }: {
  direction: AssortmentDirection;
  accuracy?: Record<string, FieldAccuracy> | null;
  accuracyModel?: string | null;
  otherAccuracy?: OtherAccuracy[];
  accuracyFailed?: boolean;
  /** Размеченные и ещё не размеченные разборы текущей модели ИИ. */
  judgedModels: number;
  unjudgedModels?: number;
  /** Разборы прежней моделью ИИ той же версии вопроса с неотмеченными признаками: выдаются после разборов текущей. */
  otherModelUnjudged?: number;
  /** Модели с неотмеченными признаками, но недоступным фото: на разметку не выдаются. */
  photoUnavailable?: number;
}) {
  const fields = ATTRIBUTE_FIELDS[direction].filter((f) => isJudgeableField(f.key));
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
      <div className="font-medium text-slate-800">
        Размечено моделей: {num(judgedModels)}{unjudgedModels !== undefined && `, ещё с неотмеченными признаками: ${num(unjudgedModels)}`}. Точность по признакам{accuracyModel ? ` у модели ИИ ${modelName(accuracyModel)}, которая сейчас пишет разбор` : ""} (нужно {ACCURACY_MIN_JUDGED} отметок «верно / неверно» на признак):
      </div>
      {otherModelUnjudged > 0 && <p className="mt-1 text-slate-600">Ещё {num(otherModelUnjudged)} {plural(otherModelUnjudged, "модель разобрана", "модели разобраны", "моделей разобрано")} прежней моделью ИИ по тому же вопросу: их выдаём после разборов текущей модели, а отметки по ним идут в точность той модели — отдельно.</p>}
      {photoUnavailable > 0 && <p className="mt-1 text-slate-600">Ещё {num(photoUnavailable)} {plural(photoUnavailable, "модель", "модели", "моделей")} с неотмеченными признаками на разметку не выдаём: фото недоступно (ссылок на фото у модели больше нет или у вас оно не открылось — такие модели этот браузер запоминает) — отметить нечем.</p>}
      {otherAccuracy.length > 0 && <p className="mt-1 text-slate-600">Отметки по прежней модели ИИ — отдельно и в эту точность не входят: {otherAccuracy.map((o) => `${modelName(o.aiModel)} — ${num(o.marks)} ${plural(o.marks, "отметка", "отметки", "отметок")}`).join("; ")}.</p>}
      {accuracyFailed ? (
        <p className="mt-1 text-amber-800">Точность не загрузилась — размечайте дальше, отметки сохраняются; сводка появится после обновления страницы.</p>
      ) : (
        <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
          {fields.map((f) => <li key={f.key}>{f.label} — {accuracyLabel(accuracy?.[f.key])}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Карточки примеров — отдельно от загрузки, чтобы их можно было показать на любых данных. */
export interface JudgingProps {
  /** Версия вопроса, по которой ставятся отметки: у разбора по прежней версии кнопок нет (отметка в текущую точность не войдёт). */
  currentVersion: string;
  /** Отметки, которые сейчас сохраняются (verdictKey): их кнопки на это время недоступны, остальные работают. */
  busyKeys: ReadonlySet<string>;
  /** Сбои сохранения по отметкам: показываются под признаком, у которого не сохранилось. */
  errors: Record<string, string>;
  onVerdict: (sample: PhotoSample, field: string, verdict: Verdict | null) => void;
}

const VERDICT_BUTTONS: Array<{ verdict: Verdict; label: string; on: string }> = [
  { verdict: "ok", label: "Верно", on: "bg-green-700 text-white" },
  { verdict: "wrong", label: "Неверно", on: "bg-red-700 text-white" },
  { verdict: "unclear", label: "Не понять", on: "bg-slate-600 text-white" },
];

export type SampleImageStage = "direct" | "proxy" | "failed";

/** Адрес фото примера: сначала ссылка сайта бренда, затем (если известна строка каталога) — через панель. */
export function sampleImageSrc(sample: Pick<PhotoSample, "sourceId" | "itemId" | "imageUrl">, stage: SampleImageStage): string {
  if (stage === "proxy" && sample.itemId) {
    return `/api/assortment-development/catalog/photo?source=${encodeURIComponent(sample.sourceId)}&item=${encodeURIComponent(sample.itemId)}&n=0`;
  }
  return sample.imageUrl ?? "";
}

/** Состояние фото карточки: кнопки «верно / неверно» работают только при «loaded» — отметка вслепую портит точность. */
export type SamplePhoto = "loading" | "loaded" | "failed" | "none";

/**
 * Состояние фото по этапу и по тому, какой адрес открылся. «Открылось» сравнивается с адресом ТЕКУЩЕГО этапа: когда прямая ссылка
 * не открылась и карточка перешла на запасной путь, картинка по нему снова считается загружающейся.
 */
export function samplePhotoState(sample: Pick<PhotoSample, "sourceId" | "itemId" | "imageUrl">, stage: SampleImageStage, loadedSrc: string | null): SamplePhoto {
  if (!sample.imageUrl) return "none";
  if (stage === "failed") return "failed";
  return loadedSrc === sampleImageSrc(sample, stage) ? "loaded" : "loading";
}

const VERDICT_NAME: Record<Verdict, string> = { ok: "верно", wrong: "неверно", unclear: "не понять" };

/**
 * Одна карточка примера. Фото с сайта бренда не всегда открывается из России: сначала прямая ссылка, не открылась — один раз через панель
 * (как в каталоге), потом «фото не открылось». Сверить ответ ИИ с картинкой, которой нет, нельзя: кнопок «верно/неверно» нет, пока фото
 * не открылось (прячем, а не серим) — иначе отметки ставились бы вслепую и портили точность. Уже поставленная отметка не пропадает вместе
 * с фото: её видно и можно снять.
 */
function SampleCard({ sample, judging, onPhotoFailed }: { sample: PhotoSample; judging?: JudgingProps; onPhotoFailed?: (sample: PhotoSample) => void }) {
  const [stage, setStage] = useState<SampleImageStage>("direct");
  // «Открылось» помним по адресу, а не флагом: при переходе на запасной путь прежнее «открылось» не переносится на новую картинку.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const src = sampleImageSrc(sample, stage);
  const photo = samplePhotoState(sample, stage, loadedSrc);
  // Картинка из кэша могла открыться раньше, чем у неё появился обработчик: событие load уже прошло, а complete — истинно.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth > 0) setLoadedSrc(src);
  }, [src]);
  // Фото так и не открылось (ни прямо, ни через панель) или его нет: следующая выборка разметки эту модель не предложит.
  useEffect(() => {
    if (photo === "failed" || photo === "none") onPhotoFailed?.(sample);
  }, [photo, sample, onPhotoFailed]);
  return (
    <SampleCardView
      sample={sample}
      judging={judging}
      photo={photo}
      src={src}
      imageRef={img}
      onLoad={() => setLoadedSrc(src)}
      onError={() => setStage((cur) => (cur === "direct" && sample.itemId ? "proxy" : "failed"))}
    />
  );
}

/** Карточка по готовому состоянию фото — отдельно от загрузки, чтобы показывать её (и проверять) в любом состоянии. */
export function SampleCardView({
  sample,
  judging,
  photo,
  src,
  imageRef,
  onLoad,
  onError,
}: {
  sample: PhotoSample;
  judging?: JudgingProps;
  photo: SamplePhoto;
  src?: string;
  imageRef?: Ref<HTMLImageElement>;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const judgeable = (key: string, notVisible: boolean) =>
    Boolean(judging && sample.modelKey && sample.promptVersion === judging.currentVersion && !notVisible && isJudgeableField(key));
  const anyJudgeable = sample.attributes.some((a) => judgeable(a.key, a.notVisible));
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
      <div className="flex gap-3">
        {photo === "loading" || photo === "loaded" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={imageRef} src={src ?? sample.imageUrl ?? ""} alt={sample.title} loading="lazy" referrerPolicy="no-referrer" onLoad={onLoad} onError={onError} className="h-32 w-24 shrink-0 rounded-lg bg-slate-100 object-cover" />
        ) : (
          <div className="grid h-32 w-24 shrink-0 place-items-center rounded-lg bg-slate-100 px-1 text-center text-xs text-slate-400">{photo === "failed" ? "фото не открылось" : "нет фото"}</div>
        )}
        <div className="min-w-0">
          <div className="break-anywhere text-sm font-medium text-slate-900">{sample.title || "Без названия"}</div>
          <div className="text-xs text-slate-500">{sample.sourceName}</div>
          {sample.model && <div className="text-[11px] text-slate-400">{sample.model}</div>}
        </div>
      </div>
      <dl className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-x-2 gap-y-0.5 text-xs">
        {sample.attributes.map((a) => {
          // Отметить можно признак, который ИИ действительно написал, у разбора по текущей версии вопроса; цвет, фактура и детали —
          // свободный текст, сверять с ним нечего. Ставить отметку можно, только когда фото открылось.
          const markable = judgeable(a.key, a.notVisible);
          const canJudge = markable && photo === "loaded";
          const key = verdictKey(sample, a.key);
          const busy = Boolean(judging?.busyKeys.has(key));
          const failure = judging?.errors[key];
          const current = sample.verdicts?.[a.key] ?? null;
          return (
            <div key={a.key} className="contents">
              <dt className="text-slate-500">{a.label}</dt>
              <dd className={a.notVisible ? "text-slate-400" : "text-slate-800"}>
                {a.notVisible ? "не видно" : a.value}
                {!a.notVisible && a.confidence !== null && a.confidence < 0.6 && <span className="text-amber-700"> · неуверенно</span>}
                {canJudge && judging && (
                  <span role="group" aria-label={`Точность: ${a.label}`} className="mt-1 flex flex-wrap gap-1">
                    {VERDICT_BUTTONS.map((b) => (
                      <button
                        key={b.verdict}
                        type="button"
                        aria-pressed={current === b.verdict}
                        disabled={busy}
                        onClick={() => judging.onVerdict(sample, a.key, current === b.verdict ? null : b.verdict)}
                        className={`h-10 min-w-10 rounded-lg px-2 text-xs disabled:opacity-60 ${current === b.verdict ? b.on : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </span>
                )}
                {markable && !canJudge && current && judging && (
                  // Фото нет или оно ещё грузится, а отметка уже стоит: она не пропадает. Снять можно, когда фото не откроется (менять вслепую нельзя).
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-slate-700">
                    <span>Отметка: {VERDICT_NAME[current]}</span>
                    {photo !== "loading" && (
                      <button type="button" disabled={busy} onClick={() => judging.onVerdict(sample, a.key, null)} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        Снять отметку
                      </button>
                    )}
                  </span>
                )}
                {markable && failure && <span role="alert" className="mt-1 block text-red-700">Не сохранилось: {failure}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {judging && anyJudgeable && photo === "loading" && <p className="text-xs leading-5 text-slate-500">Фото загружается… Кнопки «верно / неверно» появятся, когда оно откроется: без картинки отметка была бы вслепую.</p>}
      {judging && anyJudgeable && (photo === "failed" || photo === "none") && <p className="text-xs leading-5 text-amber-800">{photo === "failed" ? "Фото не открылось" : "Фото нет"} — отметить признаки нечем: без картинки отметка была бы вслепую.</p>}
    </article>
  );
}

export function SampleCards({ samples, judging, onPhotoFailed }: { samples: PhotoSample[]; judging?: JudgingProps; onPhotoFailed?: (sample: PhotoSample) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {samples.map((sample) => <SampleCard key={`${sample.sourceId}:${sample.title}:${sample.takenAt}`} sample={sample} judging={judging} onPhotoFailed={onPhotoFailed} />)}
    </div>
  );
}
