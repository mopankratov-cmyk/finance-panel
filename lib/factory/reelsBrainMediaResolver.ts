import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ReelsBrainResolvedMedia = {
  media_url: string | null;
  title: string | null;
  author: string | null;
  duration_sec: number | null;
  extractor: string | null;
  source: "yt_dlp";
};

function text(value: unknown, max = 1200): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out ? out.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pickFormatUrl(payload: Record<string, unknown>): string | null {
  const direct = text(payload.url);
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const requested = Array.isArray(payload.requested_formats) ? payload.requested_formats : [];
  for (const format of requested) {
    const url = text(rec(format).url);
    if (url && /^https?:\/\//i.test(url)) return url;
  }

  const formats = Array.isArray(payload.formats) ? payload.formats : [];
  for (const format of [...formats].reverse()) {
    const row = rec(format);
    const url = text(row.url);
    const ext = text(row.ext, 20);
    const vcodec = text(row.vcodec, 40);
    if (url && /^https?:\/\//i.test(url) && (ext === "mp4" || vcodec && vcodec !== "none")) return url;
  }

  return null;
}

export async function hasYtDlpBinary(): Promise<boolean> {
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export async function resolveMediaLocatorViaYtDlp(url: string): Promise<ReelsBrainResolvedMedia | null> {
  const target = text(url, 1500);
  if (!target) return null;
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["-J", "--no-warnings", "--skip-download", target],
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    const mediaUrl = pickFormatUrl(payload);
    return {
      media_url: mediaUrl,
      title: text(payload.title, 500),
      author: text(payload.uploader, 240) || text(payload.channel, 240),
      duration_sec: num(payload.duration),
      extractor: text(payload.extractor_key, 120) || text(payload.extractor, 120),
      source: "yt_dlp",
    };
  } catch {
    return null;
  }
}
