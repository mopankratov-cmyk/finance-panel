import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Авто-сборка niche_playbooks для ниш с данными в orbit_searches, но без плейбука.
// POST { refresh_days?: number } — refresh_days=7 обновляет и сталые плейбуки (старше N дней).
// Строит плейбук для каждой «голой» или сталой ниши (макс 5 за вызов, ~20с каждый).
// Вызывается из cockpit-кнопки «🧠 Плейбуки» или из corpus-cron (шаг 3).

export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const refreshDays: number | null = typeof body.refresh_days === "number" && body.refresh_days > 0 ? body.refresh_days : null;

  const origin = req.nextUrl.origin;
  const log: string[] = [];
  const built: string[] = [];
  const skipped: string[] = [];

  try {
    const [orbitRes, playbookRes] = await Promise.all([
      db.from("orbit_searches").select("niche").limit(50),
      db.from("niche_playbooks").select("niche,updated_at").limit(50),
    ]);

    const orbitNiches = [...new Set((orbitRes.data ?? []).map((r: { niche: string }) => r.niche).filter(Boolean))];
    const playbookMap = new Map<string, string>(
      (playbookRes.data ?? []).map((r: { niche: string; updated_at: string | null }) => [r.niche, r.updated_at || ""])
    );

    // ниши без плейбука вообще
    const missing = orbitNiches.filter((n) => !playbookMap.has(n));

    // ниши с сталым плейбуком (если передан refresh_days)
    let stale: string[] = [];
    if (refreshDays !== null) {
      const cutoff = new Date(Date.now() - refreshDays * 24 * 60 * 60 * 1000).toISOString();
      stale = orbitNiches.filter((n) => {
        const at = playbookMap.get(n);
        return at !== undefined && at < cutoff;
      });
      if (stale.length) log.push(`Сталые плейбуки (>${refreshDays}д): ${stale.join(", ")}`);
    }

    const need = [...new Set([...missing, ...stale])].slice(0, 5);

    if (!need.length) {
      skipped.push(...orbitNiches.filter((n) => playbookMap.has(n)));
      return NextResponse.json({ ok: true, built: [], skipped, log: ["Все ниши покрыты актуальными плейбуками"] });
    }

    // Параллельно: ниши независимы, niche-playbook строит из корпуса (без Virlo) → общее время = одна ниша, не сумма.
    await Promise.all(need.map(async (niche) => {
      try {
        const r = await internalFetch(`${origin}/api/factory/niche-playbook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ niche }),
          signal: AbortSignal.timeout(45000),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && (j.playbook || j.ok !== false)) {
          built.push(niche);
          log.push(`✓ ${niche}`);
        } else {
          log.push(`✗ ${niche}: ${j.error || r.statusText}`);
        }
      } catch (e) {
        log.push(`✗ ${niche}: ${String(e).slice(0, 60)}`);
      }
    }));

    skipped.push(...orbitNiches.filter((n) => playbookMap.has(n) && !stale.includes(n) && !missing.includes(n)));
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 120) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, built, skipped, log });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      built: [],
      skipped: [],
      log: ["сборка недостающих плейбуков упала: " + String((e as Error)?.message || e).slice(0, 160)],
    }, { status: 500 });
  }
}
