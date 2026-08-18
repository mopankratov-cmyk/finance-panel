"use client";
/* eslint-disable @next/next/no-img-element */

import { AlertTriangle, BadgeCheck, Check, ChevronLeft, ChevronRight, Clapperboard, Clock3, Download, ExternalLink, Hand, ImageIcon, Loader2, PackageSearch, Play, RefreshCw, Search, ShieldCheck, Sparkles, UserRound, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatTime } from "@/lib/analytics/format";
import { ugcPublishPhrase, type UgcAvatarId, type UgcKind } from "@/lib/ugc/validation";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface UgcAvatar { id: UgcAvatarId; name: string; description: string }
interface UgcProduct { nmId: number; article: string; name: string; brand: string; subject: string; photos: string[]; photosCount: number; hasVideo: boolean; contentScore: number | null }
interface ScriptDraft { hook: string; script: string; shotList: string[]; imagePrompt: string; videoMotion: string }
type JobStatus = "queued" | "generating" | "done" | "error";
interface UgcJob {
  token: string;
  cabinetId: string;
  nmId: number;
  article: string;
  productName: string;
  avatarName: string;
  kind: UgcKind;
  status: JobStatus;
  createdAt: string;
  resultUrl?: string;
  error?: string;
  ageSec?: number | null;
  publishedAt?: string;
}

const STEPS = [
  { title: "Персонаж", hint: "Кто в кадре" },
  { title: "SKU", hint: "Что показываем" },
  { title: "Сценарий", hint: "Хук и кадры" },
  { title: "Генерация", hint: "Фото или видео" },
  { title: "Публикация", hint: "Отдельное подтверждение" },
] as const;

const avatarIcons = { product: PackageSearch, creator: UserRound, expert: BadgeCheck, hands: Hand } as const;
const storageKey = (cabinetId: string) => `fp_ugc_jobs:${cabinetId}`;
const JOB_STATUSES: JobStatus[] = ["queued", "generating", "done", "error"];

function validStoredJob(value: unknown): value is UgcJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<UgcJob>;
  return typeof row.token === "string" && row.token.length > 20
    && typeof row.cabinetId === "string" && Number.isSafeInteger(row.nmId)
    && typeof row.article === "string" && (row.kind === "image" || row.kind === "video")
    && Boolean(row.status && JOB_STATUSES.includes(row.status)) && typeof row.createdAt === "string";
}

function safeTime(value: string | undefined) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return formatTime(value);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { ok?: boolean; error?: string };
  if (!response.ok || body.ok === false) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

function jobTone(status: JobStatus) {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function jobLabel(status: JobStatus) {
  return ({ queued: "В очереди", generating: "Генерируется", done: "Готово", error: "Ошибка" } as const)[status];
}

export function WbUgcPage() {
  const { activeCabinet, cabinetId, cabinets, canWrite, ready, loading: cabinetsLoading, error: cabinetsError, user } = useWbCabinet();
  const [step, setStep] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [avatars, setAvatars] = useState<UgcAvatar[]>([]);
  const [products, setProducts] = useState<UgcProduct[]>([]);
  const [avatarId, setAvatarId] = useState<UgcAvatarId>("product");
  const [nmId, setNmId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState<ScriptDraft | null>(null);
  const [kind, setKind] = useState<UgcKind>("image");
  const [jobs, setJobs] = useState<UgcJob[]>([]);
  const [jobsCabinet, setJobsCabinet] = useState("");
  const [selectedToken, setSelectedToken] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [busy, setBusy] = useState<"script" | "generate" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [publishChecked, setPublishChecked] = useState(false);
  const [publishText, setPublishText] = useState("");

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!canWrite) {
      setProducts([]);
      setError(cabinets.length ? "Для UGC Studio выберите один реальный кабинет в верхней панели" : cabinetsError || "Подключите WB-кабинет");
      return;
    }
    const controller = new AbortController();
    setCatalogLoading(true); setError(null); setMessage(null);
    api<{ ok: true; products: UgcProduct[]; avatars: UgcAvatar[] }>(`/api/ugc/catalog?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then((body) => { setProducts(body.products); setAvatars(body.avatars); setNmId((current) => body.products.some((product) => product.nmId === current) ? current : null); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить UGC Studio"); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, canWrite, ready, retryKey]);

  useEffect(() => {
    if (!canWrite || !cabinetId) { setJobs([]); setJobsCabinet(""); return; }
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey(cabinetId)) || "[]") as unknown;
      setJobs(Array.isArray(parsed) ? parsed.filter(validStoredJob).slice(0, 20) : []);
    } catch { setJobs([]); }
    setJobsCabinet(cabinetId);
    setSelectedToken("");
    setStep(1); setFurthest(1); setDraft(null); setNmId(null); setPublishChecked(false); setPublishText("");
  }, [cabinetId, canWrite]);

  useEffect(() => {
    if (!cabinetId || jobsCabinet !== cabinetId) return;
    try { localStorage.setItem(storageKey(cabinetId), JSON.stringify(jobs.slice(0, 20))); } catch { /* очередь останется в памяти */ }
  }, [cabinetId, jobs, jobsCabinet]);

  const pendingTokens = useMemo(() => jobs.filter((job) => job.status === "queued" || job.status === "generating").map((job) => job.token), [jobs]);
  useEffect(() => {
    if (!pendingTokens.length) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const updates = await Promise.all(pendingTokens.map(async (token) => {
        try {
          const body = await api<{ ok: true; task: { status: JobStatus; resultUrl?: string; error?: string; ageSec?: number | null } }>("/api/ugc/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
          return { token, ...body.task };
        } catch (cause) { return { token, status: "generating" as const, error: `${cause instanceof Error ? cause.message : "Не удалось проверить задачу"}. Повторим автоматически` }; }
      }));
      if (cancelled) return;
      setJobs((current) => current.map((job) => {
        const update = updates.find((item) => item.token === job.token);
        return update ? { ...job, status: update.status, resultUrl: update.resultUrl ?? job.resultUrl, error: update.error, ageSec: update.ageSec ?? job.ageSec } : job;
      }));
    }, 3_500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pendingTokens]);

  const selectedProduct = products.find((product) => product.nmId === nmId) ?? null;
  const selectedAvatar = avatars.find((avatar) => avatar.id === avatarId) ?? avatars[0] ?? null;
  const selectedJob = jobs.find((job) => job.token === selectedToken) ?? jobs.find((job) => job.status === "done") ?? null;
  const jobProduct = selectedJob ? products.find((product) => product.nmId === selectedJob.nmId) ?? null : null;
  const publishPhrase = jobProduct ? ugcPublishPhrase(jobProduct.article) : "";
  const filteredProducts = products.filter((product) => !query.trim() || `${product.nmId} ${product.article} ${product.name} ${product.brand}`.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")));

  const go = (next: number) => { setStep(next); setFurthest((current) => Math.max(current, next)); setError(null); setMessage(null); };
  const chooseProduct = (product: UgcProduct) => { setNmId(product.nmId); setDraft(null); setPublishChecked(false); setPublishText(""); };

  const makeScript = async () => {
    if (!selectedProduct) { setError("Сначала выберите SKU"); return; }
    setBusy("script"); setError(null); setMessage(null);
    try {
      const body = await api<{ ok: true; script: ScriptDraft }>("/api/ugc/script", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cabinetId, nmId: selectedProduct.nmId, avatarId, brief }) });
      setDraft(body.script); setMessage("Сценарий готов — проверьте факты и отредактируйте текст перед генерацией");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать сценарий"); }
    finally { setBusy(null); }
  };

  const generate = async () => {
    if (!selectedProduct || !selectedAvatar || !draft) { setError("Сначала выберите SKU и подготовьте сценарий"); return; }
    setBusy("generate"); setError(null); setMessage(null);
    try {
      const body = await api<{ ok: true; task: Pick<UgcJob, "token" | "cabinetId" | "nmId" | "article" | "kind" | "status" | "createdAt"> }>("/api/ugc/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cabinetId, nmId: selectedProduct.nmId, avatarId, kind, script: draft.script, imagePrompt: draft.imagePrompt, videoMotion: draft.videoMotion }) });
      const job: UgcJob = { ...body.task, productName: selectedProduct.name || selectedProduct.article, avatarName: selectedAvatar.name };
      setJobs((current) => [job, ...current].slice(0, 20)); setSelectedToken(job.token); setMessage("Задача добавлена в очередь. Можно продолжать работу — статус обновится автоматически.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось запустить генерацию"); }
    finally { setBusy(null); }
  };

  const publish = async () => {
    if (!selectedJob || !jobProduct) return;
    const phrase = ugcPublishPhrase(jobProduct.article);
    if (!publishChecked || publishText !== phrase) { setError(`Подтвердите действие и введите: ${phrase}`); return; }
    if (!window.confirm(`Опубликовать новый результат первым фото карточки ${jobProduct.article} в WB? Это изменит публичную карточку.`)) return;
    setBusy("publish"); setError(null); setMessage(null);
    try {
      const body = await api<{ ok: true; publishedAt: string }>("/api/ugc/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: selectedJob.token, confirmation: publishText }) });
      setJobs((current) => current.map((job) => job.token === selectedJob.token ? { ...job, publishedAt: body.publishedAt } : job));
      setMessage("Новая обложка опубликована в WB и записана в аудит");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось опубликовать результат"); }
    finally { setBusy(null); }
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-20 md:pb-6">
      <WbModuleHeader icon={Clapperboard} title="UGC Studio" description={activeCabinet ? `${activeCabinet.name} · сценарий, генерация и контролируемая публикация` : "Пятишаговая контент-студия"} actions={<button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={catalogLoading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:min-h-9">{catalogLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}Обновить</button>} />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <ol className="grid grid-cols-2 sm:grid-cols-5 overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Шаги UGC Studio">
          {STEPS.map((item, index) => { const number = index + 1; const available = number <= furthest; const active = number === step; const complete = number < step; return <li key={item.title} className="min-w-0"><button type="button" disabled={!available} onClick={() => available && go(number)} aria-current={active ? "step" : undefined} className={`flex min-h-14 w-full items-center gap-2 border-r border-slate-100 px-2 text-left transition-colors last:border-r-0 disabled:cursor-not-allowed sm:px-3 ${active ? "bg-violet-50" : available ? "hover:bg-slate-50" : "opacity-45"}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${active ? "bg-violet-600 text-white" : complete ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{complete ? <Check className="h-3.5 w-3.5" /> : number}</span><span className="min-w-0"><span className={`block truncate text-[10px] font-bold ${active ? "text-violet-700" : "text-slate-600"}`}>{item.title}</span><span className="hidden truncate text-[9px] text-slate-400 lg:block">{item.hint}</span></span></button></li>; })}
        </ol>

        {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
        {message ? <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"><Check className="mt-0.5 h-4 w-4 shrink-0" />{message}</div> : null}

        {!canWrite ? <WbErrorState message={error || "Выберите один реальный кабинет"} /> : catalogLoading ? <div className="grid min-h-[420px] place-items-center rounded-xl border border-slate-200 bg-white"><div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Загружаю кабинетный каталог…</div></div> : (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
            <main className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.04)] sm:p-5">
              {step === 1 ? <section aria-labelledby="ugc-avatar-title"><div><h2 id="ugc-avatar-title" className="text-base font-bold text-slate-800">1. Выберите формат персонажа</h2><p className="mt-1 text-xs leading-5 text-slate-500">Персонаж задаёт подачу, но исходное фото разрешённого SKU остаётся обязательным референсом товара.</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{avatars.map((avatar) => { const Icon = avatarIcons[avatar.id]; const active = avatar.id === avatarId; return <button key={avatar.id} type="button" onClick={() => setAvatarId(avatar.id)} aria-pressed={active} className={`min-h-32 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${active ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:border-violet-200 hover:bg-slate-50"}`}><span className={`grid h-10 w-10 place-items-center rounded-xl ${active ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500"}`}><Icon className="h-5 w-5" /></span><span className="mt-3 block text-sm font-bold text-slate-700">{avatar.name}</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{avatar.description}</span></button>; })}</div><div className="mt-5 flex justify-end"><button type="button" onClick={() => go(2)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700">Выбрать SKU <ChevronRight className="h-4 w-4" /></button></div></section> : null}

              {step === 2 ? <section aria-labelledby="ugc-product-title"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div><h2 id="ugc-product-title" className="text-base font-bold text-slate-800">2. Выберите SKU</h2><p className="mt-1 text-xs leading-5 text-slate-500">Каталог уже ограничен выбранным кабинетом и его товарным контуром.</p></div><label className="ml-auto flex min-h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 sm:max-w-xs"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск SKU" placeholder="артикул, nm, название" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label></div>{filteredProducts.length ? <div className="mt-4 grid max-h-[520px] gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">{filteredProducts.map((product) => { const active = product.nmId === nmId; return <button key={product.nmId} type="button" onClick={() => chooseProduct(product)} aria-pressed={active} className={`flex min-h-28 gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${active ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:border-violet-200"}`}>{product.photos[0] ? <img src={product.photos[0]} alt={`Фото ${product.article}`} loading="lazy" className="h-20 w-16 shrink-0 rounded-lg border border-slate-100 object-cover" /> : <span className="grid h-20 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-300"><ImageIcon className="h-5 w-5" /></span>}<span className="min-w-0"><span className="block truncate text-xs font-bold text-violet-700">{product.article}</span><span className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-600">{product.name || `nm ${product.nmId}`}</span><span className="mt-2 block text-[9px] text-slate-400">{product.brand} · {product.photosCount} фото · Content {product.contentScore ?? 0}%{product.hasVideo ? " · есть видео" : ""}</span></span></button>; })}</div> : <WbEmptyState>В товарном контуре кабинета нет SKU по этому запросу.</WbEmptyState>}<div className="mt-5 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => go(1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><ChevronLeft className="h-4 w-4" />Назад</button><button type="button" onClick={() => go(3)} disabled={!selectedProduct} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-40">К сценарию <ChevronRight className="h-4 w-4" /></button></div></section> : null}

              {step === 3 ? <section aria-labelledby="ugc-script-title"><h2 id="ugc-script-title" className="text-base font-bold text-slate-800">3. Подготовьте сценарий</h2><p className="mt-1 text-xs leading-5 text-slate-500">AI использует только выбранный разрешённый SKU. Проверьте факты: публикация не должна обещать свойства, которых нет в карточке.</p><label className="mt-4 block text-xs font-semibold text-slate-600">Креативный бриф<textarea value={brief} onChange={(event) => setBrief(event.target.value.slice(0, 1500))} rows={3} placeholder="Аудитория, ситуация использования, желаемая подача…" className="mt-1 min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal leading-5 outline-none focus:border-violet-400" /></label><button type="button" onClick={() => void makeScript()} disabled={busy === "script" || !selectedProduct} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50">{busy === "script" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <WandSparkles className="h-4 w-4" />}{draft ? "Перегенерировать" : "Создать сценарий"}</button>{draft ? <div className="mt-4 space-y-3"><div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="text-[9px] font-bold uppercase text-violet-500">Хук</div><input value={draft.hook} onChange={(event) => setDraft({ ...draft, hook: event.target.value })} aria-label="Хук сценария" className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-3 text-sm font-semibold outline-none focus:border-violet-400" /></div><label className="block text-xs font-semibold text-slate-600">Текст ролика<textarea value={draft.script} onChange={(event) => setDraft({ ...draft, script: event.target.value.slice(0, 4000) })} rows={5} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal leading-6 outline-none focus:border-violet-400" /></label><div><div className="text-xs font-semibold text-slate-600">План кадров</div><ol className="mt-2 grid gap-2 sm:grid-cols-3">{draft.shotList.map((shot, index) => <li key={`${shot}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] leading-4 text-slate-600"><span className="font-bold text-violet-600">{index + 1}.</span> {shot}</li>)}</ol></div></div> : null}<div className="mt-5 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => go(2)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><ChevronLeft className="h-4 w-4" />Назад</button><button type="button" onClick={() => go(4)} disabled={!draft?.script} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-40">К генерации <ChevronRight className="h-4 w-4" /></button></div></section> : null}

              {step === 4 ? <section aria-labelledby="ugc-generation-title"><h2 id="ugc-generation-title" className="text-base font-bold text-slate-800">4. Запустите генерацию</h2><p className="mt-1 text-xs leading-5 text-slate-500">Исходное фото SKU всегда передаётся как референс. Задача остаётся в очереди, если закрыть страницу.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{(["image", "video"] as UgcKind[]).map((value) => <button key={value} type="button" onClick={() => setKind(value)} aria-pressed={kind === value} className={`min-h-28 rounded-xl border p-4 text-left ${kind === value ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:border-violet-200"}`}>{value === "image" ? <ImageIcon className="h-6 w-6 text-violet-600" /> : <Clapperboard className="h-6 w-6 text-violet-600" />}<span className="mt-2 block text-sm font-bold text-slate-700">{value === "image" ? "Фото 3:4" : "Короткое видео"}</span><span className="mt-1 block text-[10px] text-slate-500">{value === "image" ? "Новая сцена для карточки" : "Анимация исходного фото без автопубликации"}</span></button>)}</div><div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><b>{selectedProduct?.article}</b> · {selectedAvatar?.name} · {kind === "image" ? "1536×2048" : "720p"}</div><button type="button" onClick={() => void generate()} disabled={busy === "generate" || !draft || !selectedProduct?.photos[0]} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 text-xs font-semibold text-white shadow-sm disabled:opacity-50">{busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}Добавить в очередь</button>{!selectedProduct?.photos[0] ? <div className="mt-2 text-xs text-rose-600">У товара нет исходного фото — генерация недоступна.</div> : null}<div className="mt-5 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => go(3)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><ChevronLeft className="h-4 w-4" />Назад</button><button type="button" onClick={() => go(5)} disabled={!jobs.some((job) => job.status === "done")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 text-xs font-semibold text-violet-700 disabled:opacity-40">К результатам <ChevronRight className="h-4 w-4" /></button></div></section> : null}

              {step === 5 ? <section aria-labelledby="ugc-publish-title"><h2 id="ugc-publish-title" className="text-base font-bold text-slate-800">5. Проверьте и опубликуйте</h2><p className="mt-1 text-xs leading-5 text-slate-500">Генерация сама ничего не меняет в WB. Фото публикуется только после двойного подтверждения директора; видео — вручную.</p>{selectedJob?.status === "done" && selectedJob.resultUrl ? <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]"><div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">{selectedJob.kind === "image" ? <img src={selectedJob.resultUrl} alt={`UGC-результат ${selectedJob.article}`} className="max-h-[560px] w-full object-contain" /> : <video src={selectedJob.resultUrl} controls preload="metadata" className="max-h-[560px] w-full" />}</div><div className="space-y-3"><div className="rounded-xl border border-slate-200 p-3"><div className="text-[9px] uppercase text-slate-400">Результат</div><div className="mt-1 text-sm font-bold text-slate-700">{selectedJob.article} · {selectedJob.kind === "image" ? "фото" : "видео"}</div><div className="mt-1 text-[10px] text-slate-500">{selectedJob.avatarName} · {safeTime(selectedJob.createdAt)}</div></div><div className="flex flex-wrap gap-2"><a href={selectedJob.resultUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><ExternalLink className="h-4 w-4" />Открыть файл</a><a href={selectedJob.resultUrl} download className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><Download className="h-4 w-4" />Скачать</a>{selectedJob.kind === "image" ? <a href={`/card-editor?img=${encodeURIComponent(selectedJob.resultUrl)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700"><WandSparkles className="h-4 w-4" />Добавить текст</a> : null}</div>{selectedJob.kind === "video" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><AlertTriangle className="mr-1 inline h-4 w-4" />Видео скачивается и загружается в кабинет WB вручную. Автопубликация видео не включена.</div> : selectedJob.publishedAt ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-4 w-4" />Опубликовано {safeTime(selectedJob.publishedAt)}</div> : <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><div className="text-xs font-bold text-rose-800">Публичное изменение карточки WB</div><p className="mt-1 text-[10px] leading-4 text-rose-700">Результат станет первым фото. Текущие фото сохраняются после него. Для карточек с видео действие заблокировано.</p><label className="mt-3 flex min-h-11 items-start gap-2 text-[10px] font-semibold text-rose-800"><input type="checkbox" checked={publishChecked} onChange={(event) => setPublishChecked(event.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-600" />Я проверил изображение, факты о товаре и порядок фотографий.</label><label className="mt-2 block text-[10px] font-semibold text-rose-800">Введите: {publishPhrase || "—"}<input value={publishText} onChange={(event) => setPublishText(event.target.value)} disabled={!jobProduct} className="mt-1 min-h-11 w-full rounded-lg border border-rose-200 bg-white px-3 font-mono text-xs outline-none focus:border-rose-400" /></label><button type="button" onClick={() => void publish()} disabled={busy === "publish" || !publishChecked || !jobProduct || publishText !== publishPhrase || user?.role !== "director" || Boolean(jobProduct?.hasVideo)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white disabled:opacity-40">{busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="h-4 w-4" />}Опубликовать обложку в WB</button>{user?.role !== "director" ? <div className="mt-2 text-[10px] text-rose-700">Публикация доступна только директору.</div> : jobProduct?.hasVideo ? <div className="mt-2 text-[10px] text-rose-700">У SKU есть видео — используйте ручную загрузку.</div> : null}</div>}</div></div> : <WbEmptyState>Выберите готовую задачу в очереди справа.</WbEmptyState>}<div className="mt-5"><button type="button" onClick={() => go(4)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600"><ChevronLeft className="h-4 w-4" />К генерации</button></div></section> : null}
            </main>

            <aside className="rounded-xl border border-slate-200 bg-white p-3 xl:sticky xl:top-[66px] xl:max-h-[calc(100vh-80px)] xl:overflow-auto" aria-labelledby="ugc-queue-title"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-violet-500" /><h2 id="ugc-queue-title" className="text-xs font-bold text-slate-800">Очередь генерации</h2><span className="ml-auto rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-500">{jobs.length}</span></div><p className="mt-1 text-[9px] leading-4 text-slate-400">Хранится в этом браузере отдельно для кабинета. Подписанный task token действует 48 часов.</p>{jobs.length ? <div className="mt-3 space-y-2">{jobs.map((job) => { const active = selectedJob?.token === job.token; return <button key={job.token} type="button" onClick={() => { setSelectedToken(job.token); if (job.status === "done") go(5); }} className={`w-full rounded-xl border p-3 text-left transition-colors ${active ? "border-violet-400 ring-1 ring-violet-200" : "border-slate-200 hover:border-violet-200"}`}><div className="flex items-start gap-2"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${job.kind === "image" ? "bg-fuchsia-50 text-fuchsia-600" : "bg-violet-50 text-violet-600"}`}>{job.status === "queued" || job.status === "generating" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : job.kind === "image" ? <ImageIcon className="h-4 w-4" /> : <Play className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-bold text-slate-700">{job.article}</span><span className="mt-0.5 block truncate text-[9px] text-slate-400">{job.avatarName} · {safeTime(job.createdAt)}</span></span><span className={`rounded-full border px-2 py-1 text-[8px] font-bold ${jobTone(job.status)}`}>{jobLabel(job.status)}</span></div>{job.error ? <span className="mt-2 block text-[9px] leading-4 text-rose-600">{job.error}</span> : null}{(job.status === "queued" || job.status === "generating") && Number(job.ageSec) >= 60 ? <span className="mt-2 block text-[9px] leading-4 text-amber-700">Дольше минуты. Можно убрать задачу локально и запустить новую — провайдер не поддерживает отмену.</span> : null}{job.publishedAt ? <span className="mt-2 flex items-center gap-1 text-[9px] font-semibold text-emerald-700"><Check className="h-3 w-3" />Опубликовано</span> : null}</button>; })}<div className="flex flex-wrap"><button type="button" onClick={() => { setJobs((current) => current.filter((job) => job.status === "queued" || job.status === "generating")); setSelectedToken(""); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" />Убрать завершённые</button>{jobs.some((job) => (job.status === "queued" || job.status === "generating") && Number(job.ageSec) >= 60) ? <button type="button" onClick={() => { setJobs((current) => current.filter((job) => !((job.status === "queued" || job.status === "generating") && Number(job.ageSec) >= 60))); setSelectedToken(""); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold text-amber-700 hover:text-rose-600"><X className="h-3.5 w-3.5" />Убрать зависшие</button> : null}</div></div> : <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-6 text-center text-[10px] leading-4 text-slate-400">Задач пока нет. Подготовьте сценарий и добавьте первую генерацию.</div>}</aside>
          </div>
        )}
      </div>
    </div>
  );
}
