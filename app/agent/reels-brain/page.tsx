import { connection } from "next/server";
import { cookies, headers } from "next/headers";

import ReelsBrainPixelCockpit from "./ReelsBrainPixelCockpit";

type JsonRecord = Record<string, any>;

async function readJson(path: string): Promise<{ ok: true; data: JsonRecord } | { ok: false; error: string }> {
  try {
    const h = await headers();
    const c = await cookies();
    const proto = h.get("x-forwarded-proto") || "https";
    const host = h.get("x-forwarded-host") || h.get("host");
    if (!host) return { ok: false, error: "host missing" };
    const response = await fetch(`${proto}://${host}${path}`, {
      cache: "no-store",
      headers: {
        cookie: c.toString(),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: String(data?.error || data?.warning || response.statusText || "request failed") };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}

export default async function Page() {
  await connection();
  const niches = ["ru_toys", "ru_clothing", "ru_cosmetics"];
  const nicheParam = niches.join(",");
  const [learningRes, corpusRes, learningPlanRes, progressRes, healthRes, ...summaryRes] = await Promise.all([
    readJson(`/api/factory/reels-brain/learning-economics?niches=${encodeURIComponent(nicheParam)}&limit=80&compact=1`),
    readJson("/api/factory/reels-brain/corpus?limit=200&min_score=0"),
    readJson(`/api/factory/reels-brain/learning-plan?niches=${encodeURIComponent(nicheParam)}&platforms=tiktok,instagram,youtube&target=10000&max_backlog_before_analyze=180`),
    readJson(`/api/factory/reels-brain/progress?niches=${encodeURIComponent(nicheParam)}`),
    readJson(`/api/factory/reels-brain/health?niches=${encodeURIComponent(nicheParam)}`),
    ...niches.map((niche) => readJson(`/api/factory/reels-brain/summary?niche=${encodeURIComponent(niche)}`)),
  ]);

  const failures = [
    learningRes.ok ? null : `learning-economics: ${learningRes.error}`,
    corpusRes.ok ? null : `corpus: ${corpusRes.error}`,
    learningPlanRes.ok ? null : `learning-plan: ${learningPlanRes.error}`,
    progressRes.ok ? null : `progress: ${progressRes.error}`,
    healthRes.ok ? null : `health: ${healthRes.error}`,
    ...summaryRes.map((item, index) => (item.ok ? null : `summary ${niches[index]}: ${item.error}`)),
  ].filter(Boolean) as string[];

  return (
    <ReelsBrainPixelCockpit
      initialData={{
        learning: learningRes.ok ? learningRes.data : {},
        corpus: corpusRes.ok ? corpusRes.data : {},
        learningPlan: learningPlanRes.ok ? learningPlanRes.data : {},
        progress: progressRes.ok ? progressRes.data : {},
        health: healthRes.ok ? healthRes.data : {},
        summaries: summaryRes.map((item) => (item.ok ? item.data : {})),
        error: failures.length ? `Часть слоёв временно недоступна: ${failures.slice(0, 2).join(" · ")}` : "",
      }}
    />
  );
}
