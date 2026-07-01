import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildViewingIntelligenceReport, type ReelsViewingSourceRow } from "@/lib/factory/reelsBrainViewingIntelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseList(value: string | null, fallback: string): string[] {
  return Array.from(new Set(String(value || fallback)
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 12);
}

function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function layerStatus(score: number) {
  if (score >= 75) return "live";
  if (score >= 40) return "training";
  if (score > 0) return "prototype";
  return "blocked";
}

function titlePlatform(value: string) {
  if (value === "instagram") return "Instagram";
  if (value === "youtube") return "YouTube";
  if (value === "tiktok") return "TikTok";
  return value || "Unknown";
}

function inferAudience(niche: string, text: string) {
  const body = `${niche} ${text}`.toLowerCase();
  if (/toy|игруш|дет|ребен|мам|пап|подар/.test(body)) return "мамы / подарки / дети";
  if (/cloth|одеж|пример|образ|лук|размер/.test(body)) return "женская аудитория / образ / примерка";
  if (/cosmetic|космет|крем|кожа|макияж|уход/.test(body)) return "beauty-аудитория / уход / результат";
  return "широкая импульсная аудитория";
}

function inferProductFit(niche: string) {
  const key = niche.toLowerCase();
  if (key.includes("toy")) return ["игрушки", "подарки детям", "развивающие товары"];
  if (key.includes("cloth")) return ["одежда", "примерка", "образы / комплекты"];
  if (key.includes("cosmetic")) return ["косметика", "уход", "до/после"];
  return ["маркетплейс-товары", "импульсные покупки"];
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const sp = req.nextUrl.searchParams;
    const niches = parseList(sp.get("niches") || sp.get("niche"), "ru_toys,ru_clothing,ru_cosmetics");
    const platforms = parseList(sp.get("platforms") || sp.get("platform"), "tiktok,instagram,youtube");
    const limitPerNiche = Math.min(2000, Math.max(20, Number(sp.get("limit_per_niche") || 500)));
    const rows: ReelsViewingSourceRow[] = [];
    const warnings: string[] = [];

    if (!db) {
      warnings.push("Supabase не настроен: content director работает в empty-mode.");
    } else {
      for (const niche of niches) {
        let query = db
          .from("viral_videos")
          .select("id,url,platform,niche,caption,hook_text,format_detected,sound_title,source_orbit_id,views,likes,followers_creator,virality_score,created_at,analyzed,analyzed_full")
          .eq("niche", niche)
          .order("virality_score", { ascending: false, nullsFirst: false })
          .limit(limitPerNiche);
        if (platforms.length) query = query.in("platform", platforms);
        const { data, error } = await query;
        if (error) {
          warnings.push(`${niche}: ${error.message}`);
          continue;
        }
        rows.push(...((data || []) as ReelsViewingSourceRow[]));
      }
    }

    const report = buildViewingIntelligenceReport(rows);
    const total = report.summary.total;
    const top = report.top_candidates.slice(0, 10);
    const buildBriefs = top.slice(0, 10).map((candidate, index) => {
      const audience = inferAudience(candidate.niche, `${candidate.creative_dna.hook} ${candidate.creative_brief.retention_mechanic}`);
      return {
        id: `rb-director-${candidate.video_id || index + 1}`,
        priority: candidate.priority,
        platform: titlePlatform(candidate.platform),
        niche: candidate.niche,
        hook: candidate.creative_brief.hook,
        audience,
        product_fit: inferProductFit(candidate.niche),
        retention_mechanic: candidate.creative_brief.retention_mechanic,
        second_by_second: candidate.creative_brief.second_by_second_structure,
        visual_recipe: candidate.creative_brief.visual_recipe,
        experiment_axis: index % 4 === 0 ? "hook" : index % 4 === 1 ? "editing" : index % 4 === 2 ? "audio_start" : "cta",
        copy_as_mechanic: candidate.creative_brief.copy_mechanic,
        do_not_copy: candidate.creative_brief.do_not_copy,
        anti_patterns: candidate.anti_patterns,
        source_url: candidate.url,
        score: candidate.score,
      };
    });

    const high = report.summary.high_priority;
    const buildBrief = report.summary.build_brief;
    const media = report.summary.analyze_media + report.summary.resolve_mp4;
    const platformRows = Object.entries(report.summary.by_platform || {}).map(([platform, row]) => ({
      platform: titlePlatform(platform),
      total: row.total,
      high_priority: row.high_priority,
      avg_score: row.avg_score,
      confidence: row.total ? Math.min(100, Math.round(row.avg_score * 0.8 + pct(row.high_priority, row.total) * 0.2)) : 0,
      action: row.total === 0
        ? "добрать источники"
        : row.high_priority > 0
          ? "делать briefs и эксперименты"
          : "добирать более сильные референсы",
    }));

    const layerScores = {
      asr_transcript: media ? 35 : 5,
      audience_brain: high ? 55 : 25,
      product_brain: buildBriefs.length ? 60 : 20,
      anti_pattern_brain: top.some((row) => row.anti_patterns.length) ? 55 : 25,
      experiment_brain: buildBriefs.length >= 4 ? 70 : buildBriefs.length ? 45 : 15,
      discovery_brain_v2: report.source_quality.best_sources.length ? 65 : 25,
      platform_coverage: platformRows.length ? Math.round(platformRows.reduce((sum, row) => sum + row.confidence, 0) / platformRows.length) : 0,
      creative_brief_export: buildBriefs.length ? 85 : 10,
      daily_learning_report: total ? 75 : 15,
      quality_monitor: total ? Math.round(Math.min(100, report.summary.avg_score)) : 0,
    };

    const layers = [
      { key: "asr_transcript", title: "ASR / Transcript", score: layerScores.asr_transcript, status: layerStatus(layerScores.asr_transcript), next: "подключить runtime ASR к direct audio/mp4 и сохранять first_phrase/speech_rate" },
      { key: "audience_brain", title: "Audience Brain", score: layerScores.audience_brain, status: layerStatus(layerScores.audience_brain), next: "учить сегменты аудитории на high-priority референсах" },
      { key: "product_brain", title: "Product Brain", score: layerScores.product_brain, status: layerStatus(layerScores.product_brain), next: "связать product_fit с каталогом товаров и артикулами" },
      { key: "anti_pattern_brain", title: "Anti Pattern Brain", score: layerScores.anti_pattern_brain, status: layerStatus(layerScores.anti_pattern_brain), next: "копить negative examples и запрещенные механики" },
      { key: "experiment_brain", title: "Experiment Brain", score: layerScores.experiment_brain, status: layerStatus(layerScores.experiment_brain), next: "генерировать A/B пакеты: hook/audio/editing/CTA" },
      { key: "discovery_brain_v2", title: "Discovery Brain v2", score: layerScores.discovery_brain_v2, status: layerStatus(layerScores.discovery_brain_v2), next: "искать маленькие аккаунты с залетами и слабые источники отключать" },
      { key: "platform_coverage", title: "Instagram / YouTube Coverage", score: layerScores.platform_coverage, status: layerStatus(layerScores.platform_coverage), next: "добирать платформы с низким confidence отдельно от TikTok" },
      { key: "creative_brief_export", title: "Creative Brief Export", score: layerScores.creative_brief_export, status: layerStatus(layerScores.creative_brief_export), next: "отдавать briefs в контент-завод или дизайнеру" },
      { key: "daily_learning_report", title: "Daily Learning Report", score: layerScores.daily_learning_report, status: layerStatus(layerScores.daily_learning_report), next: "слать ежедневное резюме роста/цены/следующих решений" },
      { key: "quality_monitor", title: "Brain Quality Monitor", score: layerScores.quality_monitor, status: layerStatus(layerScores.quality_monitor), next: "подсвечивать низкую уверенность по нишам/платформам/источникам" },
    ];

    const dailyReport = [
      `Корпус для content director: ${total} видео, high-priority: ${high}.`,
      `В работу можно брать ${buildBrief} creative briefs и ${media} media/ASR кандидатов.`,
      platformRows.length
        ? `Самая сильная платформа сейчас: ${platformRows.slice().sort((a, b) => b.confidence - a.confidence)[0]?.platform}.`
        : "Платформенная карта пока пустая.",
      report.source_quality.best_sources[0]
        ? `Лучший источник: ${report.source_quality.best_sources[0].source}.`
        : "Нужны новые source-aware прогоны для оценки источников.",
    ];

    return NextResponse.json({
      ok: true,
      mode: "reels_brain_content_director",
      niches,
      platforms,
      limit_per_niche: limitPerNiche,
      layers,
      daily_report: dailyReport,
      export_briefs: buildBriefs,
      platform_coverage: platformRows,
      source_efficiency: report.source_quality,
      quality_monitor: {
        total,
        avg_score: report.summary.avg_score,
        high_priority: high,
        medium_priority: report.summary.medium_priority,
        low_priority: report.summary.low_priority,
        build_brief: buildBrief,
        media_candidates: media,
        confidence: total ? Math.min(100, Math.round(report.summary.avg_score * 0.7 + pct(high, total) * 0.3)) : 0,
      },
      warnings,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "content-director reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
