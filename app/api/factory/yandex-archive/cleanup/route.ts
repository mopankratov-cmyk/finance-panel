import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import {
  deleteYandexArchiveFile,
  isDeletableFalVideoPath,
  listYandexArchiveFolder,
  type YandexArchiveEntry,
} from "@/lib/factory/yandexArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Janitor архива fal-video: листинг папки, план дублей, удаление только с явным confirm.
// Дубли = один task (имя файла без hash-хвоста), несколько hash-копий от повторных опросов
// video-fal-status до stableKey; держим самую свежую копию, остальные — кандидаты на удаление.

const CONFIRM = "delete-fal-video";

function dupKey(name: string): string {
  return name.replace(/-[a-f0-9]{6,12}(\.[a-z0-9]{2,5})$/i, "$1");
}

function buildDuplicatePlan(entries: YandexArchiveEntry[]) {
  const files = entries.filter((e) => e.type === "file");
  const groups = new Map<string, YandexArchiveEntry[]>();
  for (const file of files) {
    const key = dupKey(file.name);
    groups.set(key, [...(groups.get(key) || []), file]);
  }
  const duplicates: YandexArchiveEntry[] = [];
  const keep: YandexArchiveEntry[] = [];
  for (const [, group] of groups) {
    const sorted = [...group].sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    keep.push(sorted[0]);
    duplicates.push(...sorted.slice(1));
  }
  return { keep, duplicates: duplicates.filter((d) => isDeletableFalVideoPath(d.path)) };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const sp = req.nextUrl.searchParams;
    const path = String(sp.get("path") || "").trim();
    if (!path) return NextResponse.json({ ok: false, error: "нужен path" }, { status: 400 });
    const listed = await listYandexArchiveFolder(path, Number(sp.get("limit") || 500));
    if (!listed.ok) return NextResponse.json({ ok: false, error: listed.error }, { status: 502 });

    const plan = buildDuplicatePlan(listed.entries);
    const apply = sp.get("apply") === "1" && sp.get("confirm") === CONFIRM;
    let deleted: Array<{ path: string; ok: boolean; error?: string }> = [];
    if (apply) {
      deleted = [];
      for (const dup of plan.duplicates) {
        const res = await deleteYandexArchiveFile(dup.path);
        deleted.push({ path: dup.path, ok: res.ok, error: res.error });
      }
    }

    return NextResponse.json({
      ok: true,
      path,
      apply,
      entries: listed.entries,
      duplicate_plan: {
        keep: plan.keep.map((e) => e.path),
        delete_candidates: plan.duplicates.map((e) => ({ path: e.path, size: e.size, created: e.created })),
      },
      deleted,
      confirm_hint: apply ? null : `для удаления дублей добавь apply=1&confirm=${CONFIRM}`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "yandex-archive cleanup GET crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

// Точечное удаление конкретных файлов (каждый путь валидируется: только fal-video медиа).
export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const paths = Array.isArray(body.paths) ? body.paths.map((p: unknown) => String(p || "").trim()).filter(Boolean).slice(0, 100) : [];
    if (!paths.length) return NextResponse.json({ ok: false, error: "нужен paths[]" }, { status: 400 });
    if (body.confirm !== CONFIRM) return NextResponse.json({ ok: false, error: `нужен confirm: ${CONFIRM}` }, { status: 400 });

    const rejected = paths.filter((p: string) => !isDeletableFalVideoPath(p));
    if (rejected.length) return NextResponse.json({ ok: false, error: "пути вне fal-video архива не удаляются", rejected }, { status: 400 });

    const deleted: Array<{ path: string; ok: boolean; error?: string }> = [];
    for (const p of paths) {
      const res = await deleteYandexArchiveFile(p);
      deleted.push({ path: p, ok: res.ok, error: res.error });
    }
    return NextResponse.json({
      ok: deleted.every((d) => d.ok),
      deleted,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "yandex-archive cleanup POST crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
