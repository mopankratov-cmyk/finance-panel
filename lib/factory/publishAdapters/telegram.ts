import { buildCaption, configEnv, configText } from "./shared";
import type { ChannelAdapter, MetricSnapshot, PublishMedia, PublishMeta, PublishResult, PublishTarget } from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";

function text(value: unknown, max = 500): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function numericChatId(chatId: string): string | null {
  const cleaned = chatId.replace(/\s+/g, "");
  return /^-?\d+$/.test(cleaned) ? cleaned : null;
}

function requireTelegramConfig(target: PublishTarget) {
  const botToken = configEnv(target.config, "bot_token", "botToken", "bot_token_env", "token_env", "tokenEnv")
    || text(process.env.FACTORY_TG_BOT_TOKEN, 4000);
  const chatId = configText(target.config, "chat_id", "chatId", "channel_id", "channelId", "destination_chat_id")
    || text(process.env.FACTORY_TG_CHAT_ID, 120);
  const channelUsername = configText(target.config, "channel_username", "channelUsername", "username");
  if (!botToken) throw new Error("Telegram bot token is not configured");
  if (!chatId && !channelUsername) throw new Error("Telegram target missing chat_id or channel_username (and FACTORY_TG_CHAT_ID is not configured)");
  return {
    botToken,
    chatId: chatId || channelUsername || "",
    channelUsername,
  };
}

async function telegramApi<T>(botToken: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const detail = text((json as Record<string, unknown>)?.description || res.statusText, 220) || `Telegram ${res.status}`;
    throw new Error(detail);
  }
  return json.result as T;
}

function telegramPostUrl(chatId: string, messageId: number, channelUsername: string | null) {
  if (channelUsername) {
    const username = channelUsername.replace(/^@/, "");
    return `https://t.me/${encodeURIComponent(username)}/${messageId}`;
  }
  const numeric = numericChatId(chatId);
  if (numeric?.startsWith("-100")) return `https://t.me/c/${numeric.slice(4)}/${messageId}`;
  return `https://t.me/${encodeURIComponent(chatId)}/${messageId}`;
}

function fileNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const tail = url.pathname.split("/").filter(Boolean).pop() || "video.mp4";
    return tail.endsWith(".mp4") ? tail : `${tail}.mp4`;
  } catch {
    return "video.mp4";
  }
}

async function telegramUploadVideo(botToken: string, body: {
  chatId: string;
  caption: string;
  videoUrl: string;
}) {
  const mediaRes = await fetch(body.videoUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  if (!mediaRes.ok) {
    throw new Error(`remote media fetch failed: ${mediaRes.status}`);
  }

  const blob = await mediaRes.blob();
  const form = new FormData();
  form.set("chat_id", body.chatId);
  form.set("caption", body.caption);
  form.set("supports_streaming", "true");
  form.set("video", blob, fileNameFromUrl(body.videoUrl));

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendVideo`, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const detail = text((json as Record<string, unknown>)?.description || res.statusText, 220) || `Telegram ${res.status}`;
    throw new Error(detail);
  }
  return json.result as { message_id?: number };
}

export const telegramAdapter: ChannelAdapter = {
  platform: "telegram",
  transport: "api",
  capabilities: {
    publish: true,
    metrics: false,
    authCheck: true,
  },

  async authSession(target) {
    try {
      const { botToken, chatId } = requireTelegramConfig(target);
      await telegramApi(botToken, "getChat", { chat_id: chatId });
      return "OK";
    } catch (error) {
      const detail = String((error as Error)?.message || error).toLowerCase();
      if (
        detail.includes("unauthorized")
        || detail.includes("chat not found")
        || detail.includes("forbidden")
        || detail.includes("token is not configured")
        || detail.includes("target missing chat_id")
      ) return "NEEDS_MANUAL_LOGIN";
      return "CAPTCHA";
    }
  },

  async publish(media: PublishMedia, meta: PublishMeta, target: PublishTarget): Promise<PublishResult> {
    try {
      const { botToken, chatId, channelUsername } = requireTelegramConfig(target);
      const caption = buildCaption(meta).slice(0, 1024);
      let result: { message_id?: number } | null = null;
      let lastError: string | null = null;

      try {
        result = await telegramApi<{ message_id?: number }>(botToken, "sendVideo", {
          chat_id: chatId,
          video: media.video_path_or_url,
          caption,
          supports_streaming: true,
        });
      } catch (error) {
        lastError = text((error as Error)?.message || error, 220);
        if (/^https?:\/\//i.test(media.video_path_or_url)) {
          result = await telegramUploadVideo(botToken, {
            chatId,
            caption,
            videoUrl: media.video_path_or_url,
          });
        } else {
          throw error;
        }
      }

      const messageId = Number(result?.message_id) || 0;
      if (!messageId) {
        return {
          ok: false,
          failure: "upload_failed",
          detail: lastError || "Telegram sendVideo response missing message_id",
        };
      }
      return {
        ok: true,
        external_post_id: String(messageId),
        published_url: telegramPostUrl(chatId, messageId, channelUsername),
      };
    } catch (error) {
      const detail = text((error as Error)?.message || error, 220) || "Telegram publish failed";
      const lower = detail.toLowerCase();
      if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("chat not found")) return { ok: false, failure: "needs_manual_login", detail };
      if (lower.includes("429") || lower.includes("retry after") || lower.includes("too many requests")) return { ok: false, failure: "rate_limited", detail };
      return { ok: false, failure: "upload_failed", detail };
    }
  },

  async pullMetrics(): Promise<MetricSnapshot | null> {
    return null;
  },
};
