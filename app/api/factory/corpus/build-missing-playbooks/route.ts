import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Авто-сборка niche_playbooks для ниш с данными в orbit_searches, но без плейбука.
// POST {} — без тела. Строит плейбук для каждой «голой» ниши (макс 5 за вызов, ~20с каждый).
// Безопасен: пропускает ниши у которых playbook уже есть.
// Вызывается из cockpit-кнопки «🧠 Плейбуки» или из corpus-cron (шаг 3).

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const origin = req.nextUrl.origin;
  const log: string[] = [];
  const built: string[] = [];
  const skipped: string[] = [];

  try {
    const [orbitRes, playbookRes] = await Promise.all([
      db.from("orbit_searches").select("niche").limit(50),
      db.from("niche_playbooks").select("niche").limit(50),
    ]);

    const orbitNiches = [...new Set((orbitRes.data ?? []).map((r: { niche: string }) => r.niche).filter(Boolean))];
    const have = new Set((playbookRes.data ?? []).map((r: { niche: string }) => r.niche));

    const need = orbitNiches.filter((n) => !have.has(n)).slice(0, 5);

    if (!need.length) {
      // Все ниши уже покрыты
      skipped.push(...orbitNiches.filter((n) => have.has(n)));
      return NextResponse.json({ ok: true, built: [], skipped, log: ["Все ниши уже имеют плейбук"] });
    }

    for (const niche of need) {
      try {
        const r = await fetch(`${origin}/api/factory/niche-playbook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ niche }),
          signal: AbortSignal.timeout(20000),
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
    }

    skipped.push(...orbitNiches.filter((n) => have.has(n)));
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 120) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, built, skipped, log });
}
