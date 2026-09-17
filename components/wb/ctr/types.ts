import type { CtrTestStatus, CtrTestType } from "@/lib/ctrtest/model";

export interface CtrCandidate {
  nm: number;
  art: string;
  views: number;
  spend: number;
  ctr: number | null;
  cpc: number | null;
  drr: number | null;
  stock: number;
}

export interface CtrVariantView {
  id: number;
  position: number;
  label: string;
  imageUrl: string;
  source: string;
  isBaseline: boolean;
  isWinner: boolean;
  impressions: number;
  clicks: number;
  spend: number;
  opens: number;
  carts: number;
  orders: number;
  roundsCount: number;
  roundsWon: number;
  score: number | null;
  resultPct: number | null;
}

export interface CtrRoundView {
  id: string;
  test_id: number;
  variant_id: number;
  round_number: number;
  status: "active" | "closed" | "cancelled";
  baseline: Record<string, number | string>;
  result: Record<string, number | string | boolean>;
  close_reason: string | null;
  actor: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface CtrEventView {
  id: number;
  test_id: number;
  action: string;
  actor: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CtrTestView {
  id: number;
  cabinetId: string;
  nmId: number;
  article: string;
  name: string;
  status: CtrTestStatus;
  testType: CtrTestType;
  intervalMin: number;
  impressionsPerRound: number;
  targetImpressions: number;
  spendCapRub: number;
  liveSwapEnabled: boolean;
  /** Почему последняя попытка автоматической смены не прошла. null — прошла. */
  autoError: string | null;
  roundNum: number;
  currentVariantId: number | null;
  winnerVariantId: number | null;
  winnerExplanation: string | null;
  sourceTestId: number | null;
  /** Поисковая кампания, к которой привязана метрика. null — тест не привязан (смешанная метрика по всем кампаниям, как раньше Фазы A). */
  advertId: number | null;
  /** unchecked/none/pending/confirmed/declined — состояние разбора конкурирующих полочных кампаний. */
  shelfConflictState: "unchecked" | "none" | "pending" | "confirmed" | "declined";
  /** search_only — только поиск (по умолчанию); unified — единая ставка (ЕРК), поиск+полки вместе. */
  campaignMode: "search_only" | "unified";
  /** ИИ-разбор фото по метрикам теста — null, пока не запускали. */
  aiAnalysis: { variants: { variantId: number; verdict: string }[]; recommendations: string[] } | null;
  aiAnalysisGeneratedAt: string | null;
  variants: CtrVariantView[];
  rounds: CtrRoundView[];
  history: CtrEventView[];
  currentLive: Record<string, number | string | boolean> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CtrWizardSeed {
  sourceTestId?: number | null;
  candidate?: CtrCandidate | null;
  baseline?: { label: string; imageUrl: string } | null;
}
