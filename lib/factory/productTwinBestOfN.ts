import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProductTwin, type ProductTwinBuildInput } from "./productTwinBuild";
import { pickProductSourceCandidates, type ProductSourceCandidate } from "./productSourcePicker";
import type { ProductTwin } from "./productTwin";

export interface ProductTwinAttemptResult {
  ok: boolean;
  rank: number;
  candidate?: ProductSourceCandidate;
  twinId?: string;
  qualityScore?: number;
  brollReadyAssets?: number;
  heroReadyAssets?: number;
  error?: string;
}

export interface ProductTwinBestOfNResult {
  ok: boolean;
  article: string;
  product: string;
  attemptsRequested: number;
  attempts: ProductTwinAttemptResult[];
  winner?: ProductTwin;
  winnerReason?: string;
  error?: string;
}

function winnerScore(twin: ProductTwin): number {
  const broll = twin.assets.filter((asset) => asset.brollReady).length;
  const hero = twin.assets.filter((asset) => asset.heroReady).length;
  const lowRisk = twin.assets.filter((asset) => asset.risk === "low").length;
  return twin.qualityScore + broll * 0.2 + hero * 0.08 + lowRisk * 0.02;
}

export async function buildProductTwinBestOfN(input: ProductTwinBuildInput & {
  attempts?: number;
  candidateLimit?: number;
}, db: SupabaseClient): Promise<ProductTwinBestOfNResult> {
  const article = String(input.article || "").trim();
  const product = String(input.product || article).trim();
  if (!article) return { ok: false, article, product, attemptsRequested: 0, attempts: [], error: "нужен article" };
  const attemptsRequested = Math.max(1, Math.min(5, Number(input.attempts || 3) || 3));
  const candidates = await pickProductSourceCandidates({
    article,
    product,
    limit: Math.max(attemptsRequested, input.candidateLimit || attemptsRequested),
    probeLimit: Math.max(attemptsRequested, input.candidateLimit || attemptsRequested, 8),
  });
  if (!candidates.length && !input.disk_path && !input.diskPath && !input.image_url && !input.imageUrl && !input.image_data_url && !input.imageDataUrl) {
    return { ok: false, article, product, attemptsRequested, attempts: [], error: "нет source candidates" };
  }

  const sourceAttempts = candidates.length ? candidates.slice(0, attemptsRequested) : [undefined];
  const attempts: ProductTwinAttemptResult[] = [];
  const twins: ProductTwin[] = [];
  for (let i = 0; i < sourceAttempts.length; i++) {
    const candidate = sourceAttempts[i];
    const built = await buildProductTwin({
      ...input,
      article,
      product,
      disk: candidate?.disk || input.disk,
      disk_path: candidate?.path || input.disk_path,
      diskPath: undefined,
      rebuild: true,
      force: true,
    }, db);
    if (!built.ok) {
      attempts.push({ ok: false, rank: i + 1, candidate, error: built.error });
      continue;
    }
    twins.push(built.twin);
    attempts.push({
      ok: true,
      rank: i + 1,
      candidate,
      twinId: built.twin.twinId,
      qualityScore: built.twin.qualityScore,
      brollReadyAssets: built.twin.assets.filter((asset) => asset.brollReady).length,
      heroReadyAssets: built.twin.assets.filter((asset) => asset.heroReady).length,
    });
  }
  const winner = twins.sort((a, b) => winnerScore(b) - winnerScore(a))[0];
  return {
    ok: Boolean(winner),
    article,
    product,
    attemptsRequested,
    attempts,
    winner,
    winnerReason: winner ? "highest quality + broll/hero readiness score" : undefined,
    error: winner ? undefined : "all attempts failed",
  };
}
