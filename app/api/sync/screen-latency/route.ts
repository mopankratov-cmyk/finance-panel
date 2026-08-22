import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";

// Ежедневный замер времени ключевых экранов по каждому кабинету.
//
// Все отказы, разобранные 22-23.08.2026, находились глазами владельца: РНП
// месяцами отдавал 500 на двух кабинетах, ABC собирался по 12 секунд. Никакой
// сигнал об этом не приходил. Замер пишется в тот же журнал синхронизаций, что
// и остальные задачи, поэтому деградация видна на «Здоровье» без отдельной
// инфраструктуры.
export const maxDuration = 300;

const SCREENS: Array<{ key: string; path: (cabinetId: string) => string }> = [
  { key: "РНП", path: (id) => `/api/rnp/${id}/table` },
  { key: "Воронка", path: (id) => `/api/seo/skus?cabinet=${id}&days=7` },
  { key: "Реклама", path: (id) => `/api/adverts/list?cabinet=${id}` },
  { key: "Журнал РК", path: (id) => `/api/wb/rk-journal?cabinet=${id}&days=5` },
  { key: "ABC", path: (id) => `/api/abc?cabinet=${id}` },
  { key: "Юнит", path: (id) => `/api/unit/table?cabinet=${id}` },
  { key: "Полки", path: (id) => `/api/shelf/table?cabinet=${id}` },
];

/** Медленнее этого — экран заметно «думает» и попадёт в сводку отдельно. */
const SLOW_MS = 5_000;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const origin = request.nextUrl.origin;
  const secret = process.env.CRON_SECRET;
  const targets = await getWbSyncTargets();
  const measured: Array<{ cabinet: string; screen: string; ms: number; status: number | string }> = [];

  for (const target of targets) {
    if (!target.cabinetId) continue;
    for (const screen of SCREENS) {
      const url = new URL(screen.path(target.cabinetId), origin);
      const measuredAt = Date.now();
      let status: number | string = "err";
      try {
        const response = await fetch(url.toString(), {
          cache: "no-store",
          headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
        });
        status = response.status;
        await response.arrayBuffer();
      } catch {
        status = "err";
      }
      measured.push({ cabinet: target.name, screen: screen.key, ms: Date.now() - measuredAt, status });
    }
  }

  const failed = measured.filter((row) => row.status !== 200);
  const slow = measured.filter((row) => row.status === 200 && row.ms >= SLOW_MS);
  // Отказ важнее медленности: сначала он, потом уже секунды.
  const note = [
    failed.length ? `отказы: ${failed.map((row) => `${row.cabinet}/${row.screen} ${row.status}`).join(", ")}` : "",
    slow.length ? `медленно: ${slow.map((row) => `${row.cabinet}/${row.screen} ${Math.round(row.ms / 100) / 10}с`).join(", ")}` : "",
  ].filter(Boolean).join(" | ");

  await writeSyncLog(
    "screen-latency",
    failed.length ? "error" : "ok",
    measured.length,
    note || null,
    startedAt,
  );
  return NextResponse.json({
    ok: failed.length === 0,
    measured: measured.length,
    slowest: [...measured].sort((a, b) => b.ms - a.ms).slice(0, 10),
    failed,
  });
}
