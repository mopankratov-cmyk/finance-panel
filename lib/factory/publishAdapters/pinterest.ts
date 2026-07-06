import { pinterestCreateVideoPin, pinterestGetBoard, pinterestGetPinAnalytics, pinterestRegisterVideoUpload, pinterestUploadVideoAsset, pinterestWaitForMediaReady } from "../pinterestApi";
import { buildCaption, configEnv, configText } from "./shared";
import type { ChannelAdapter, MetricSnapshot, PublishMedia, PublishMeta, PublishResult, PublishTarget } from "./types";

function text(value: unknown, max = 500): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function requirePinterestConfig(target: PublishTarget) {
  const boardId = configText(target.config, "board_id", "boardId");
  const token = configEnv(target.config, "access_token", "accessToken", "access_token_env", "token_env", "tokenEnv")
    || text(process.env.FACTORY_PINTEREST_ACCESS_TOKEN, 4000);
  if (!boardId) throw new Error("Pinterest target missing board_id");
  if (!token) throw new Error("Pinterest token is not configured");
  return { boardId, token };
}

function pinUrl(pinId: string) {
  return `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`;
}

function deriveTitle(meta: PublishMeta, media: PublishMedia) {
  return text(meta.caption, 100) || (media.article ? `WB ${media.article}` : `Recipe ${media.recipe_id}`);
}

async function downloadMedia(sourceUrl: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(sourceUrl, { cache: "no-store", signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`video download failed: ${res.status}`);
  const blob = await res.blob();
  const pathname = new URL(sourceUrl).pathname;
  const filename = pathname.split("/").pop() || `recipe-${Date.now()}.mp4`;
  return { blob, filename };
}

export const pinterestAdapter: ChannelAdapter = {
  platform: "pinterest",
  transport: "api",
  capabilities: {
    publish: true,
    metrics: true,
    authCheck: true,
  },

  async authSession(target) {
    try {
      const { boardId, token } = requirePinterestConfig(target);
      await pinterestGetBoard(token, boardId);
      return "OK";
    } catch (error) {
      const message = String((error as Error)?.message || error).toLowerCase();
      if (
        message.includes("401")
        || message.includes("403")
        || message.includes("unauthorized")
        || message.includes("token is not configured")
        || message.includes("missing board_id")
      ) return "NEEDS_MANUAL_LOGIN";
      return "CAPTCHA";
    }
  },

  async publish(media: PublishMedia, meta: PublishMeta, target: PublishTarget): Promise<PublishResult> {
    try {
      const { boardId, token } = requirePinterestConfig(target);
      const coverImageUrl = text(media.cover_path, 1200);
      if (!coverImageUrl) return { ok: false, failure: "upload_failed", detail: "Pinterest video pins require cover_path" };

      const upload = await pinterestRegisterVideoUpload(token);
      if (!upload.media_id || !upload.upload_url) return { ok: false, failure: "upload_failed", detail: "Pinterest upload registration returned incomplete payload" };

      const downloaded = await downloadMedia(media.video_path_or_url);
      await pinterestUploadVideoAsset(upload, downloaded.blob, downloaded.filename);
      await pinterestWaitForMediaReady(token, upload.media_id);

      const pin = await pinterestCreateVideoPin({
        token,
        boardId,
        title: deriveTitle(meta, media) || `Recipe ${media.recipe_id}`,
        description: buildCaption(meta),
        link: text(target.config.link, 1200) || text(target.config.destination_url, 1200) || (media.article ? `https://www.wildberries.ru/catalog/${encodeURIComponent(media.article)}/detail.aspx` : null),
        mediaId: upload.media_id,
        coverImageUrl,
      });
      const pinId = text(pin.id, 120);
      if (!pinId) return { ok: false, failure: "upload_failed", detail: "Pinterest create pin response missing id" };
      return { ok: true, external_post_id: pinId, published_url: pinUrl(pinId) };
    } catch (error) {
      const detail = text((error as Error)?.message || error, 220) || "Pinterest publish failed";
      const lower = detail.toLowerCase();
      if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized")) return { ok: false, failure: "needs_manual_login", detail };
      if (lower.includes("429") || lower.includes("rate")) return { ok: false, failure: "rate_limited", detail };
      return { ok: false, failure: "upload_failed", detail };
    }
  },

  async pullMetrics(externalPostId: string, target: PublishTarget): Promise<MetricSnapshot | null> {
    const { token } = requirePinterestConfig(target);
    const end = new Date();
    const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
    const metrics = await pinterestGetPinAnalytics({
      token,
      pinId: externalPostId,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      metricTypes: ["VIDEO_MRC_VIEW", "VIDEO_AVG_WATCH_TIME", "VIDEO_10S_VIEW", "SAVE"],
    });
    const views = Math.max(0, Math.floor(Number(metrics.VIDEO_MRC_VIEW || 0) || 0));
    if (!views) return null;
    const avgWatchTime = Number(metrics.VIDEO_AVG_WATCH_TIME || 0) || 0;
    const tenSecondViews = Math.max(0, Math.floor(Number(metrics.VIDEO_10S_VIEW || 0) || 0));
    const durationSec = Math.max(1, Number(configText(target.config, "video_duration_sec", "duration_sec", "durationSec")) || 10);
    return {
      views,
      watch_rate: avgWatchTime > 0 ? Math.max(0, Math.min(1, avgWatchTime / (durationSec * 1000))) : null,
      saves: Math.max(0, Math.floor(Number(metrics.SAVE || 0) || 0)),
      raw: {
        VIDEO_AVG_WATCH_TIME: avgWatchTime,
        VIDEO_10S_VIEW: tenSecondViews,
        VIDEO_MRC_VIEW: views,
      },
    };
  },
};
