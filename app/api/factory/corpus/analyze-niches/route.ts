import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloListOrbits, virloSearchStart } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Отдельный разбор конкурентов ПО НИШАМ: один проход → выводы (плейбук) на каждую нишу в niche_playbooks,
// «всегда готовые к работе». Контент-флоу потом берёт их мгновенно (niche-playbook/cached + ensurePlaybook).
// Логика ОРБИТО-ОРИЕНТИРОВАННАЯ (надёжнее generic sync-all):
//   1) для каждой целевой ниши находим ЛУЧШУЮ завершённую Orbit (по имени → ниша через rubric),
//   2) если у ниши нет плейбука — синкаем эту орбиту по job_id и строим плейбук (имя орбиты → верная ниша),
//   3) ниши без завершённой орбиты и без идущей — запускаем разбор (Orbit ~15-20 мин),
//   4) возвращаем готовность по каждой нише.
// POST { niches?: string[] } — по умолчанию наши рубрик-ниши.

const TARGET_NICHES = ["clothing", "toys", "cosmetics", "default"];
const NICHE_KEYWORDS: Record<string, string[]> = {
  clothing: ["женская куртка обзор", "ветровка отзыв", "пуховик тест", "куртка с маркетплейса", "осенний лук куртка"],
  toys: ["водяной пистолет обзор", "детская игрушка распаковка", "бластер тест", "игрушка для детей отзыв"],
  cosmetics: ["крем для лица обзор", "сыворотка отзыв", "уход за кожей рутина", "санскрин тест"],
  default: ["сумка обзор", "мини сумка лук", "аксессуар маркетплейс", "что в сумке"],
};

function nicheOfOrbit(name: string): string {
  return nicheFromArticle("", (name || "").replace(/^factory\s+/i, ""));
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const origin = req.nextUrl.origin;
  const body = await req.json().catch(() => ({}));
  const targets: string[] = Array.isArray(body.niches) && body.niches.length
    ? body.niches.filter((n: unknown): n is string => typeof n === "string" && !!NICHE_KEYWORDS[n])
    : TARGET_NICHES;

  const log: string[] = [];

  // Карта орбит: лучшая завершённая (макс видео) + флаг «идёт» — по нишам
  const orbits = await virloListOrbits(100).catch(() => [] as { id: string; name: string; status: string; totalVideos: number }[]);
  const bestOrbit: Record<string, { id: string; name: string; videos: number }> = {};
  const processing = new Set<string>();
  for (const o of orbits) {
    const n = nicheOfOrbit(o.name);
    if (o.status === "processing" || o.status === "pending" || o.status === "running") processing.add(n);
    if ((o.status === "completed" || o.status === "partial_failure") && o.totalVideos > 0) {
      const cur = bestOrbit[n];
      if (!cur || o.totalVideos > cur.videos) bestOrbit[n] = { id: o.id, name: o.name, videos: o.totalVideos };
    }
  }

  // Какие ниши уже покрыты плейбуком
  const pbRes = await db.from("niche_playbooks").select("niche");
  const havePb = new Set(((pbRes.data as { niche: string }[] | null) ?? []).map((r) => r.niche));

  // Прямая сборка: ниши без плейбука, но с завершённой орбитой → sync-orbit(job_id) + niche-playbook (имя орбиты → ниша)
  const toBuild = targets.filter((n) => !havePb.has(n) && bestOrbit[n]);
  await Promise.all(toBuild.map(async (niche) => {
    const ob = bestOrbit[niche];
    try {
      await internalFetch(`${origin}/api/factory/corpus/sync-orbit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: ob.id, product_name: ob.name }), signal: AbortSignal.timeout(40000),
      }).then((r) => r.json()).catch(() => null);
      const pbr = await internalFetch(`${origin}/api/factory/niche-playbook`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: ob.name, job_id: ob.id }), signal: AbortSignal.timeout(55000),
      }).then((r) => r.json()).catch(() => ({}));
      log.push(pbr && pbr.playbook ? `✓ ${niche} собран (${ob.videos} вид.)` : `✗ ${niche}: ${(pbr && pbr.error) || "не собрался"}`);
    } catch (e) { log.push(`✗ ${niche}: ${String(e).slice(0, 50)}`); }
  }));

  // Пересчитать готовность после сборки
  const pb2 = await db.from("niche_playbooks").select("niche");
  const havePb2 = new Set(((pb2.data as { niche: string }[] | null) ?? []).map((r) => r.niche));

  const status: { niche: string; state: string }[] = [];
  for (const niche of targets) {
    if (havePb2.has(niche)) { status.push({ niche, state: "ready" }); continue; }
    if (processing.has(niche)) { status.push({ niche, state: "analyzing" }); continue; }
    // нет плейбука, нет завершённой/идущей орбиты → запускаем разбор
    const jid = await virloSearchStart(NICHE_KEYWORDS[niche] || [niche]).catch(() => null);
    status.push({ niche, state: jid ? "started" : "failed" });
    if (jid) log.push(`старт орбиты «${niche}»: ${String(jid).slice(0, 8)}`);
  }

  const ready = status.filter((s) => s.state === "ready").length;
  return NextResponse.json({ ok: true, ready, total: targets.length, status, log });
}
