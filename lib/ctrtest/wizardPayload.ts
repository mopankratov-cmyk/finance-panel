import type { CtrCampaignMode, CtrTestType } from "./model";
import { ordersFit } from "./stepPlan";

/**
 * Тело запроса «создать тест» из состояния мастера.
 *
 * CTR-тест идёт на новом движке: у него раунды, шаг и потолок времени на шаг.
 * Тесты CR и видео остались на прежнем — у них прежние поля. Собирается здесь, а
 * не внутри обработчика кнопки, чтобы правило «цель варианта = показов на шаг ×
 * раундов» проверялось тестом, а не глазами.
 */
export interface WizardState {
  type: CtrTestType;
  cabinetId: string;
  nmId: number;
  article: string;
  intervalMin: number;
  /** CTR: целевые показы на шаг. CR/видео: норма раунда, как прежде. */
  impressionsPerRound: number;
  /** Только CR/видео: цель варианта. У CTR она считается из шага и числа раундов. */
  targetImpressions: number;
  spendCapRub: number;
  sourceTestId: number | null;
  campaignMode: CtrCampaignMode;
  pickedAdvertId: number | null;
  variants: { label: string; imageUrl: string; source: string }[];
  roundsTotal: number;
  maxStepMin: number;
  warmupMin: number;
  /** Порядок по раундам, заданный руками (позиции). null — по умолчанию, сдвиг. */
  customOrders: number[][] | null;
}

/** Показов на вариант за весь тест: шаг × раунды. */
export const totalPerVariant = (impressionsPerStep: number, rounds: number) => impressionsPerStep * rounds;

export function buildCreateBody(state: WizardState): Record<string, unknown> {
  const isCtr = state.type === "ctr";
  return {
    cabinetId: state.cabinetId,
    nmId: state.nmId,
    article: state.article,
    name: state.article,
    testType: state.type,
    intervalMin: state.intervalMin,
    impressionsPerRound: state.impressionsPerRound,
    targetImpressions: isCtr ? totalPerVariant(state.impressionsPerRound, state.roundsTotal) : state.targetImpressions,
    spendCapRub: state.spendCapRub,
    sourceTestId: state.sourceTestId,
    campaignMode: isCtr ? state.campaignMode : "search_only",
    advertId: isCtr ? state.pickedAdvertId : null,
    variants: state.variants,
    ...(isCtr ? {
      roundsTotal: state.roundsTotal,
      maxStepMin: state.maxStepMin,
      warmupMin: state.warmupMin,
      // Порядок уходит, только если человек его менял и он ещё подходит к числу
      // вариантов и раундов; иначе сервер поставит сдвиг по умолчанию.
      ...(ordersFit(state.customOrders, state.variants.length, state.roundsTotal) ? { variantOrders: state.customOrders } : {}),
    } : {}),
  };
}

/** Суммарный простой рекламы: после каждого шага она на паузе не меньше трёх опросов по пять минут. */
export const MIN_SETTLE_MIN_PER_STEP = 15;

export function adDowntimeHours(variantCount: number, rounds: number): number {
  return (variantCount * rounds * MIN_SETTLE_MIN_PER_STEP) / 60;
}
