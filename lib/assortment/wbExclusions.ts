import { normalizeTitle } from "./forms";

export type ExcludedReason = "men" | "kids" | "other";

const MEN_RE = /мужск|мужчин|для муж\b/;
const KIDS_RE = /детск|для дет|мальчик|девоч|подрост|школьн|малыш|новорожден/;
const OTHER_RE = /сигнальн|спасательн|для собак|для кошек|собак|ноутбук|туристическ|тактическ|военн|охотнич|рыболовн|строительн/;

/**
 * Какие запросы к нашему спросу не относятся: каталоги и профили — женские, и
 * «пуховик мужской» или «рюкзак школьный» не показывает, какую форму искать
 * женщинам. Запрос без указания пола считается нейтральным и остаётся.
 */
export function excludedReason(word: string): ExcludedReason | null {
  const text = normalizeTitle(word);
  if (MEN_RE.test(text)) return "men";
  if (KIDS_RE.test(text)) return "kids";
  if (OTHER_RE.test(text)) return "other";
  return null;
}
