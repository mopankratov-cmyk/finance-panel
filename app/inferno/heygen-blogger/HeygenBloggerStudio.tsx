"use client";

// Schema-driven панель настройки HeyGen-блогера.
// ВСЕ контролы рендерятся из describeMetrics() (единый источник — lib/factory/heygenBlogger).
// UI не хардкодит список метрик. Тот же конфиг крутит и агент (lib/factory/heygenAgentTool).
import { AlertTriangle, BadgeCheck, Bot, Cpu, ListChecks, PlayCircle, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DEFAULT_BLOGGER_CONFIG,
  METRIC_GROUPS,
  describeMetrics,
  getByPath,
  validateBloggerConfig,
  type BloggerConfig,
  type MetricDef,
  type MetricGroup,
} from "@/lib/factory/heygenBlogger";
import { applyBloggerPatch, configToHeygenPayloads } from "@/lib/factory/heygenAgentTool";

const GROUP_LABEL: Record<MetricGroup, string> = {
  identity: "Личность (S1)",
  voice: "Голос (S3)",
  render: "Рендер видео (S3)",
  motion: "Motion / камера (S3)",
  broll: "Product b-roll (manual)",
  budget: "Бюджет",
};

export default function HeygenBloggerStudio() {
  const [config, setConfig] = useState<BloggerConfig>(() => structuredCloneSafe(DEFAULT_BLOGGER_CONFIG));
  const [apiBusy, setApiBusy] = useState<string>("");
  const [apiResult, setApiResult] = useState<Record<string, unknown> | null>(null);
  const [smokeScript, setSmokeScript] = useState("Я вообще не собиралась это пробовать, но за первые пару секунд стало интересно.");
  const metrics = describeMetrics();
  const validation = useMemo(() => validateBloggerConfig(config), [config]);
  const payloads = useMemo(() => configToHeygenPayloads(config), [config]);

  function setMetric(id: string, value: unknown) {
    setConfig((prev) => applyBloggerPatch(prev, { [id]: value }).config);
  }

  async function callApi(label: string, url: string, body?: unknown) {
    setApiBusy(label);
    setApiResult(null);
    try {
      const res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      setApiResult({ label, status: res.status, ...(json && typeof json === "object" ? json : { data: json }) });
    } catch (e) {
      setApiResult({ label, ok: false, error: String((e as Error)?.message || e) });
    } finally {
      setApiBusy("");
    }
  }

  const identityCard = useMemo(() => ({
    name: config.identity.name,
    source: config.identity.source,
    avatarGroupId: config.identity.avatarGroupId || undefined,
    avatarLookId: config.identity.avatarLookId || undefined,
    voiceId: config.voice.voiceId || undefined,
    language: config.voice.language,
    prompt: config.identity.appearance,
    faceImageUrls: config.identity.faceImageKeys,
    consentConfirmed: config.identity.consentConfirmed,
    defaultAspectRatio: config.render.aspectRatio === "16:9" || config.render.aspectRatio === "1:1" ? config.render.aspectRatio : "9:16",
    persona: {
      ageRange: config.identity.age,
      gender: config.identity.gender,
      ethnicity: config.identity.ethnicity,
      speechStyle: config.motion.customMotionPrompt,
      backstory: `${config.identity.name} speaks like a casual UGC creator, not a studio presenter.`,
    },
  }), [config]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            <Sparkles className="h-4 w-4 text-cyan-700" />
            HeyGen UGC Blogger
          </div>
          <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
            Настройки блогера «по всем метрикам»
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Один источник правды: <code className="rounded bg-slate-100 px-1">lib/factory/heygenBlogger</code>. Эти же метрики
            крутит агент через <code className="rounded bg-slate-100 px-1">configure_heygen_blogger</code>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              <ListChecks className="h-3.5 w-3.5" /> {metrics.length} метрик
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              <Cpu className="h-3.5 w-3.5" /> {config.looks.length} looks
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              <Bot className="h-3.5 w-3.5" /> движок: {config.render.engine}
            </span>
            {validation.ok ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">
                <BadgeCheck className="h-3.5 w-3.5" /> конфиг валиден
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> {validation.errors.length} проблем
              </span>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-cyan-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.12em] text-cyan-800">HeyGen sidecar</h2>
              <div className="mt-1 text-sm text-slate-600">Каталог, identity plan и smoke dry-run без платного запуска.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                disabled={!!apiBusy}
                onClick={() => callApi("catalog", "/api/factory/heygen-readiness?live=1&limit=12")}
              >
                <RefreshCw className="h-4 w-4" /> Каталог
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                disabled={!!apiBusy}
                onClick={() => callApi("identity", "/api/factory/heygen-identity", identityCard)}
              >
                <UserRound className="h-4 w-4" /> Identity
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-cyan-700 bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
                disabled={!!apiBusy}
                onClick={() => callApi("smoke", "/api/factory/heygen-smoke", { identity: identityCard, script: smokeScript, realismMode: "phone_selfie", emotionalBeat: "skeptical" })}
              >
                <PlayCircle className="h-4 w-4" /> Smoke dry-run
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-slate-800">Smoke script</span>
              <textarea
                className="min-h-[74px] rounded border border-slate-300 bg-white px-2 py-1"
                value={smokeScript}
                onChange={(e) => setSmokeScript(e.target.value)}
              />
            </label>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                {apiBusy ? `Выполняю: ${apiBusy}` : "Последний ответ"}
              </div>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                {apiResult ? JSON.stringify(apiResult, null, 2) : "Нет ответа"}
              </pre>
            </div>
          </div>
        </section>

        {METRIC_GROUPS.map((group) => (
          <section key={group} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">{GROUP_LABEL[group]}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {metrics.filter((m) => m.group === group).map((m) => (
                <MetricControl key={m.id} metric={m} value={getByPath(config, m.id)} onChange={setMetric} />
              ))}
            </div>
          </section>
        ))}

        {!validation.ok && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-bold">Проблемы валидации</div>
            <ul className="mt-2 list-disc pl-5">
              {validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">BloggerConfig</h2>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
              {JSON.stringify(config, null, 2)}
            </pre>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">HeyGen payloads (preview)</h2>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
              {JSON.stringify(payloads, null, 2)}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricControl({
  metric,
  value,
  onChange,
}: {
  metric: MetricDef;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
}) {
  const badge = metric.api ? null : (
    <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">manual</span>
  );
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-slate-800">
        {metric.label}
        {badge}
        {metric.credits && <span className="ml-2 text-[11px] font-normal text-rose-600">{metric.credits}</span>}
      </span>

      {metric.type === "enum" && (
        <select
          className="rounded border border-slate-300 bg-white px-2 py-1"
          value={String(value ?? "")}
          onChange={(e) => onChange(metric.id, e.target.value)}
        >
          {metric.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {metric.type === "number" && (
        <input
          type="number"
          className="rounded border border-slate-300 bg-white px-2 py-1"
          value={Number(value ?? 0)}
          min={metric.min}
          max={metric.max}
          step={metric.step}
          onChange={(e) => onChange(metric.id, Number(e.target.value))}
        />
      )}

      {metric.type === "boolean" && (
        <input
          type="checkbox"
          className="h-4 w-4 justify-self-start"
          checked={Boolean(value)}
          onChange={(e) => onChange(metric.id, e.target.checked)}
        />
      )}

      {metric.type === "text" && (
        <textarea
          className="min-h-[38px] rounded border border-slate-300 bg-white px-2 py-1"
          rows={metric.id === "identity.appearance" ? 3 : 1}
          value={String(value ?? "")}
          onChange={(e) => onChange(metric.id, e.target.value)}
        />
      )}

      {metric.type === "image_keys" && (
        <input
          type="text"
          className="rounded border border-slate-300 bg-white px-2 py-1"
          placeholder="image_key1, image_key2, ..."
          value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(e) =>
            onChange(
              metric.id,
              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            )
          }
        />
      )}

      {metric.help && <span className="text-[11px] text-slate-500">{metric.help}</span>}
    </label>
  );
}

function structuredCloneSafe<T>(v: T): T {
  const sc = (globalThis as { structuredClone?: <U>(x: U) => U }).structuredClone;
  return sc ? sc(v) : (JSON.parse(JSON.stringify(v)) as T);
}
