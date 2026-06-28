import { NextResponse } from "next/server";
import {
  availableReelsBrainProviders,
  hasReelsBrainProvider,
  knownReelsBrainProviders,
} from "@/lib/factory/reelsBrainSources";
import { reelsBrainEnvStatus } from "@/lib/factory/reelsBrainEnv";
import { hasTrendSource, trendSourceName } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";

const envFlag = (name: string) => Boolean(process.env[name]);

// GET: provider/env health without exposing secret values.
export async function GET() {
  const known = knownReelsBrainProviders();
  const envStatus = reelsBrainEnvStatus();
  return NextResponse.json({
    ok: true,
    trend_source: {
      configured: hasTrendSource(),
      selected: trendSourceName(),
    },
    providers: known.map((provider) => ({
      provider,
      configured: hasReelsBrainProvider(provider),
    })),
    available: availableReelsBrainProviders(),
    storage: envStatus.supabase,
    scheduler: {
      CRON_SECRET: envStatus.cron_secret,
    },
    env: {
      APIFY_TOKEN: envFlag("APIFY_TOKEN"),
      APIFY_TIKTOK_ACTOR: envFlag("APIFY_TIKTOK_ACTOR"),
      APIFY_INSTAGRAM_REELS_ACTOR: envFlag("APIFY_INSTAGRAM_REELS_ACTOR"),
      APIFY_YOUTUBE_ACTOR: envFlag("APIFY_YOUTUBE_ACTOR"),
      YOUTUBE_API_KEY: envFlag("YOUTUBE_API_KEY") || envFlag("GOOGLE_YOUTUBE_API_KEY"),
      BRIGHT_DATA_API_KEY: envFlag("BRIGHT_DATA_API_KEY") || envFlag("BRIGHTDATA_API_KEY"),
      BRIGHT_DATA_INSTAGRAM_PROFILE_URLS: envFlag("BRIGHT_DATA_INSTAGRAM_PROFILE_URLS"),
      ENSEMBLEDATA_API_KEY: envFlag("ENSEMBLEDATA_API_KEY") || envFlag("ENSEMBLE_DATA_API_KEY"),
      VIRLO_API_KEY: envFlag("VIRLO_API_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: envStatus.supabase.service_role,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
