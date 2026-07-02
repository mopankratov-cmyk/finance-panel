import { createHash } from "node:crypto";

type DbClient = {
  from: (table: string) => any;
};

type AssetRow = {
  id: number;
  name?: string | null;
  kind?: string | null;
  url?: string | null;
  niche?: string | null;
  article?: string | null;
  path?: string | null;
  analysis?: Record<string, unknown> | null;
  created_at?: string | null;
};

type ArchiveStatus = "ready" | "missing_token" | "skipped" | "uploaded" | "failed";

const YANDEX_API = "https://cloud-api.yandex.net/v1/disk/resources";
const DEFAULT_ROOT = "/content-factory/archive";
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;
const ARCHIVE_KINDS = ["video", "clip", "image"] as const;
const ARCHIVE_DISKS = ["gen", "product_twin", "prepared"] as const;

function token(): string {
  return (process.env.YANDEX_DISK_OAUTH_TOKEN || process.env.YANDEX_DISK_TOKEN || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^(OAuth|Bearer)\s+/i, "")
    .trim();
}

function rootPath(): string {
  const raw = (process.env.YANDEX_DISK_FACTORY_ARCHIVE_PATH || process.env.YANDEX_DISK_ARCHIVE_DIR || DEFAULT_ROOT).trim();
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function yandexClientUrl(path = rootPath()): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `https://disk.yandex.ru/client/disk/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

function maxBytes(): number {
  const value = Number(process.env.YANDEX_DISK_ARCHIVE_MAX_BYTES || DEFAULT_MAX_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}

function safeError(error: unknown): string {
  const err = error as { message?: unknown; cause?: unknown; code?: unknown } | null;
  const parts = [err?.message, err?.cause, err?.code]
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") return JSON.stringify(part);
      return part == null ? "" : String(part);
    })
    .filter(Boolean);
  if (parts.length) return parts.join(" · ").slice(0, 220);
  if (error && typeof error === "object") {
    try { return JSON.stringify(error).slice(0, 220); } catch { return "unserializable error"; }
  }
  return String(error || "unknown").slice(0, 220);
}

function text(value: unknown, max = 120): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function slug(value: unknown, fallback: string): string {
  const s = text(value, 90)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

function safePathSegment(value: unknown, fallback: string): string {
  return slug(value, fallback).replace(/\//g, "-");
}

function mediaExt(row: Pick<AssetRow, "url" | "kind">): string {
  const url = String(row.url || "");
  const match = url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  const ext = (match?.[1] || "").toLowerCase();
  if (["mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return row.kind === "image" ? "jpg" : "mp4";
}

function mediaExtFromUrl(url: string, fallbackKind: string): string {
  const match = String(url || "").match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  const ext = (match?.[1] || "").toLowerCase();
  if (["mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return fallbackKind === "image" ? "png" : "mp4";
}

function isGeneratedMediaUrl(row: AssetRow): row is AssetRow & { url: string } {
  const url = String(row.url || "");
  if (!/^https?:\/\//i.test(url)) return false;
  if (row.kind === "image") return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url);
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
}

function archivedUrl(row: AssetRow): string {
  const analysis = row.analysis || {};
  return text(analysis.yandex_archive_url || analysis.yandex_disk_url || analysis.archive_url, 600);
}

function archiveFailed(row: AssetRow): string {
  const analysis = row.analysis || {};
  return text(analysis.yandex_archive_failed_at, 80);
}

function bearerHeaders() {
  return { Authorization: `OAuth ${token()}` };
}

export function hasYandexDiskToken(): boolean {
  return Boolean(token());
}

async function verifyYandexAccess() {
  if (!token()) {
    return { ready: false, error: "YANDEX_DISK_OAUTH_TOKEN is missing" };
  }
  const res = await yandexJson("?path=%2F", { method: "GET" });
  if (res.ok) return { ready: true, error: null };
  return {
    ready: false,
    error: `Yandex auth check: ${res.status} ${safeError((res.body as { message?: unknown })?.message || JSON.stringify(res.body))}`,
  };
}

async function yandexJson(path: string, init?: RequestInit) {
  const r = await fetch(`${YANDEX_API}${path}`, {
    ...init,
    headers: {
      ...bearerHeaders(),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

async function ensureFolder(path: string) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const res = await yandexJson(`?path=${encodeURIComponent(current)}`, { method: "PUT" });
    if (!res.ok && res.status !== 409) {
      throw new Error(`mkdir ${current}: ${res.status} ${safeError((res.body as { message?: unknown })?.message || JSON.stringify(res.body))}`);
    }
  }
}

async function getUploadHref(path: string) {
  const res = await yandexJson(`/upload?path=${encodeURIComponent(path)}&overwrite=true`, { method: "GET" });
  const href = (res.body as { href?: string }).href;
  if (!res.ok || !href) {
    throw new Error(`upload href: ${res.status} ${safeError((res.body as { message?: unknown })?.message || JSON.stringify(res.body))}`);
  }
  return href;
}

export async function getYandexDiskDownloadHref(path: string): Promise<string | null> {
  if (!token()) return null;
  const cleanPath = String(path || "").replace(/^yandex-disk:/, "");
  if (!cleanPath.startsWith("/")) return null;
  const res = await yandexJson(`/download?path=${encodeURIComponent(cleanPath)}`, { method: "GET" });
  const href = (res.body as { href?: string }).href;
  return res.ok && href ? href : null;
}

async function importUrlToYandex(path: string, sourceUrl: string) {
  await ensureFolder(path.split("/").slice(0, -1).join("/"));
  const res = await yandexJson(
    `/upload?path=${encodeURIComponent(path)}&url=${encodeURIComponent(sourceUrl)}&disable_redirects=true&overwrite=true`,
    { method: "POST" },
  );
  const href = (res.body as { href?: string }).href || null;
  if (!res.ok || !href) {
    throw new Error(`url import: ${res.status} ${safeError((res.body as { message?: unknown })?.message || JSON.stringify(res.body))}`);
  }
  return href;
}

export async function archiveExternalMediaToYandex(input: {
  sourceUrl: string;
  kind: "video" | "clip" | "image";
  article?: string | null;
  niche?: string | null;
  name?: string | null;
  subdir?: string;
  folderSegments?: (string | null | undefined)[];
  // Ключ идемпотентности: подписанные CDN-ссылки (FAL) меняются на каждый опрос статуса,
  // поэтому hash от sourceUrl плодит дубликаты файла. stableKey (например, task_id) даёт один путь.
  stableKey?: string | null;
}): Promise<{ status: ArchiveStatus; yandex_path: string | null; yandex_url: string | null; operation_href?: string; error?: string; client_url: string }> {
  const sourceUrl = text(input.sourceUrl, 4000);
  const client_url = yandexClientUrl();
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return { status: "skipped", yandex_path: null, yandex_url: null, error: "invalid source url", client_url };
  if (!token()) return { status: "missing_token", yandex_path: null, yandex_url: null, error: "YANDEX_DISK_OAUTH_TOKEN is missing", client_url };
  const day = new Date().toISOString().slice(0, 10);
  const niche = slug(input.niche, "unknown-niche");
  const article = slug(input.article, "unknown-article");
  const name = slug(input.name, "generated");
  const subdir = slug(input.subdir || "direct", "direct");
  const nested = (input.folderSegments || [])
    .map((segment, index) => safePathSegment(segment, `folder-${index + 1}`))
    .filter(Boolean)
    .join("/");
  const hash = createHash("sha1").update(text(input.stableKey, 4000) || sourceUrl).digest("hex").slice(0, 12);
  const folder = nested ? `${subdir}/${nested}` : subdir;
  const path = `${rootPath()}/${day}/${niche}/${folder}/${article}-${name}-${hash}.${mediaExtFromUrl(sourceUrl, input.kind)}`;
  try {
    const operation_href = await importUrlToYandex(path, sourceUrl);
    return { status: "uploaded", yandex_path: path, yandex_url: publicYandexHint(path), operation_href, client_url: yandexClientUrl(path.split("/").slice(0, -1).join("/")) };
  } catch (error) {
    return { status: "failed", yandex_path: path, yandex_url: null, error: safeError(error), client_url };
  }
}

async function uploadBufferToYandex(path: string, buf: Buffer, contentType: string) {
  await ensureFolder(path.split("/").slice(0, -1).join("/"));
  const href = await getUploadHref(path);
  const put = await fetch(href, {
    method: "PUT",
    body: new Blob([new Uint8Array(buf)], { type: contentType }),
    headers: { "Content-Type": contentType },
    signal: AbortSignal.timeout(120000),
  });
  if (!put.ok) throw new Error(`upload put: ${put.status}`);
}

export async function uploadFactoryBufferToYandex(input: {
  buffer: Buffer;
  contentType: string;
  kind: "video" | "clip" | "image";
  article?: string | null;
  niche?: string | null;
  name?: string | null;
  subdir?: string;
  folderSegments?: (string | null | undefined)[];
  ext?: string;
}): Promise<{ status: ArchiveStatus; yandex_path: string | null; yandex_url: string | null; download_url: string | null; error?: string; client_url: string }> {
  const client_url = yandexClientUrl();
  if (!token()) return { status: "missing_token", yandex_path: null, yandex_url: null, download_url: null, error: "YANDEX_DISK_OAUTH_TOKEN is missing", client_url };
  const day = new Date().toISOString().slice(0, 10);
  const niche = slug(input.niche, "unknown-niche");
  const article = slug(input.article, "unknown-article");
  const name = slug(input.name, "generated");
  const subdir = slug(input.subdir || "direct", "direct");
  const nested = (input.folderSegments || [])
    .map((segment, index) => safePathSegment(segment, `folder-${index + 1}`))
    .filter(Boolean)
    .join("/");
  const hash = createHash("sha1").update(input.buffer).digest("hex").slice(0, 12);
  const ext = (input.ext || (input.kind === "image" ? "png" : "mp4")).replace(/^\./, "").toLowerCase();
  const folder = nested ? `${subdir}/${nested}` : subdir;
  const path = `${rootPath()}/${day}/${niche}/${folder}/${article}-${name}-${hash}.${ext}`;
  try {
    await uploadBufferToYandex(path, input.buffer, input.contentType);
    const download_url = await getYandexDiskDownloadHref(path);
    return {
      status: "uploaded",
      yandex_path: path,
      yandex_url: publicYandexHint(path),
      download_url,
      client_url: yandexClientUrl(path.split("/").slice(0, -1).join("/")),
    };
  } catch (error) {
    return { status: "failed", yandex_path: path, yandex_url: null, download_url: null, error: safeError(error), client_url };
  }
}

async function downloadVideo(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`download ${r.status}`);
  const length = Number(r.headers.get("content-length") || 0);
  if (length > maxBytes()) throw new Error(`too large: ${length} bytes`);
  const contentType = r.headers.get("content-type") || "video/mp4";
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes()) throw new Error(`too large: ${buf.byteLength} bytes`);
  return { buf, contentType };
}

function archivePath(row: AssetRow): string {
  const day = String(row.created_at || new Date().toISOString()).slice(0, 10);
  const niche = slug(row.niche, "unknown-niche");
  const article = slug(row.article, `asset-${row.id}`);
  const name = slug(row.name, `asset-${row.id}`);
  const kind = slug(row.kind || "media", "media");
  return `${rootPath()}/${day}/${niche}/${kind}/${article}-${row.id}-${name}.${mediaExt(row)}`;
}

async function loadCandidateRows(db: DbClient, limit: number, includeArchived: boolean): Promise<AssetRow[]> {
  const out: AssetRow[] = [];
  for (let from = 0; out.length < limit && from < 5000; from += 1000) {
    const { data, error } = await db
      .from("content_assets")
      .select("id,name,kind,url,niche,article,path,analysis,created_at")
      .in("disk", ARCHIVE_DISKS)
      .in("kind", ARCHIVE_KINDS)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of ((data || []) as AssetRow[])) {
      if (!isGeneratedMediaUrl(row)) continue;
      if (!includeArchived && (archivedUrl(row) || archiveFailed(row))) continue;
      out.push(row);
      if (out.length >= limit) break;
    }
    if ((data || []).length < 1000) break;
  }
  return out;
}

function publicYandexHint(path: string): string {
  return `yandex-disk:${path}`;
}

export async function archiveFactoryVideosToYandex(db: DbClient | null | undefined, input?: {
  apply?: boolean;
  limit?: number;
  includeArchived?: boolean;
}) {
  const apply = input?.apply === true;
  const limit = Math.min(Math.max(Number(input?.limit || DEFAULT_LIMIT), 1), 50);
  const includeArchived = input?.includeArchived === true;
  const hasToken = !!token();

  if (!db) {
    return {
      ok: false,
      ready: false,
      apply,
      status: "failed" as ArchiveStatus,
      error: "Supabase is not configured",
      items: [],
    };
  }

  const rows = await loadCandidateRows(db, limit, includeArchived);
  const items: Array<{
    id: number;
    kind: string | null;
    status: ArchiveStatus;
    source_url: string;
    yandex_path: string;
    yandex_url: string | null;
    error: string | null;
  }> = [];

  if (!apply || !hasToken) {
    const access = hasToken ? await verifyYandexAccess() : { ready: false, error: "YANDEX_DISK_OAUTH_TOKEN is missing" };
    return {
      ok: !hasToken || access.ready,
      ready: access.ready,
      apply,
      status: !hasToken ? "missing_token" as ArchiveStatus : access.ready ? "ready" as ArchiveStatus : "failed" as ArchiveStatus,
      error: access.error,
      token_env: "YANDEX_DISK_OAUTH_TOKEN",
      root_path: rootPath(),
      client_url: yandexClientUrl(),
      max_bytes: maxBytes(),
      candidates: rows.length,
      items: rows.map((row) => {
        const yandexPath = archivePath(row);
        return {
          id: row.id,
          kind: row.kind || null,
          status: !hasToken ? "missing_token" as ArchiveStatus : "ready" as ArchiveStatus,
          source_url: row.url || "",
          yandex_path: yandexPath,
          yandex_url: archivedUrl(row) || null,
          error: null,
        };
      }),
    };
  }

  for (const row of rows) {
    const yandexPath = archivePath(row);
    try {
      const sourceUrl = row.url || "";
      const operationHref = await importUrlToYandex(yandexPath, sourceUrl);
      const yandexUrl = publicYandexHint(yandexPath);
      const analysis = {
        ...(row.analysis || {}),
        yandex_archive_url: yandexUrl,
        yandex_archive_path: yandexPath,
        yandex_archived_at: new Date().toISOString(),
        yandex_archive_operation_href: operationHref,
        yandex_archive_source: "factory_yandex_archive_v1",
      };
      const { error } = await db.from("content_assets").update({ analysis }).eq("id", row.id);
      if (error) throw new Error(`db update: ${error.message}`);
      items.push({ id: row.id, kind: row.kind || null, status: "uploaded", source_url: sourceUrl, yandex_path: yandexPath, yandex_url: yandexUrl, error: null });
    } catch (error) {
      const message = safeError(error);
      try {
        const analysis = {
          ...(row.analysis || {}),
          yandex_archive_error: message,
          yandex_archive_failed_at: new Date().toISOString(),
          yandex_archive_source: "factory_yandex_archive_v1",
        };
        await db.from("content_assets").update({ analysis }).eq("id", row.id);
      } catch {
        // Best effort: failed source should not block the rest of the archive forever.
      }
      items.push({ id: row.id, kind: row.kind || null, status: "failed", source_url: row.url || "", yandex_path: yandexPath, yandex_url: null, error: message });
    }
  }

  return {
    ok: items.every((item) => item.status === "uploaded"),
    ready: true,
    apply,
    status: items.some((item) => item.status === "failed") ? "failed" as ArchiveStatus : "uploaded" as ArchiveStatus,
    token_env: "YANDEX_DISK_OAUTH_TOKEN",
    root_path: rootPath(),
    client_url: yandexClientUrl(),
    max_bytes: maxBytes(),
    candidates: rows.length,
    uploaded: items.filter((item) => item.status === "uploaded").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  };
}
