import { normalizeDistributionPlatform } from "../distribution";
import { sanitizePublishTarget } from "./shared";
import { pinterestAdapter } from "./pinterest";
import { telegramAdapter } from "./telegram";
import type { ChannelAdapter, PublishTarget } from "./types";

const ADAPTERS: Record<string, ChannelAdapter> = {
  pinterest: pinterestAdapter,
  telegram: telegramAdapter,
};

export function getChannelAdapter(platform: unknown): ChannelAdapter | null {
  const normalized = normalizeDistributionPlatform(platform);
  return ADAPTERS[normalized] || null;
}

export function toPublishTarget(row: unknown): PublishTarget {
  return sanitizePublishTarget(row);
}
