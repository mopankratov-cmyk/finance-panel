export interface HookJudgeCandidate {
  id: string;
  hook: string;
  source_index: number;
}

export interface HookJudgeCorpusHook {
  hook_text?: string | null;
  text?: string | null;
  viability_score?: number | null;
  score?: number | null;
}

export interface HookJudgeRanked extends HookJudgeCandidate {
  score: number;
  verdict: "strong" | "ok" | "weak";
  reasons: string[];
}

export interface HookJudgeResult {
  ok: boolean;
  source: "deterministic";
  winner: HookJudgeRanked | null;
  ranked: HookJudgeRanked[];
  corpus_used: number;
  error?: string;
}

const GENERIC = [
  "привет",
  "сегодня расскажу",
  "хочу показать",
  "представляем",
  "это не просто",
  "идеальный",
  "лучший",
  "купите",
  "успейте",
  "в современном мире",
];

const STRONG_PATTERNS = [
  /не\s+покупай/i,
  /провер(ил|ила|яем)/i,
  /через\s+\d+/i,
  /\d+\s*(час|дн|сек|мин|₽|руб|%)/i,
  /почему/i,
  /что\s+будет/i,
  /до\s*\/?\s*после/i,
  /миф/i,
  /ошибк/i,
  /сравн/i,
  /тест/i,
];

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokens(value: string): string[] {
  return clean(value).toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((t) => t.length >= 4).slice(0, 18);
}

function normalizeCandidates(input: unknown): HookJudgeCandidate[] {
  const raw = Array.isArray(input) ? input : (clean(input) ? [input] : []);
  return raw.map((item, i) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      return { id: clean(rec.id || rec.label || `hook-${i + 1}`) || `hook-${i + 1}`, hook: clean(rec.hook || rec.hook_text || rec.text), source_index: i };
    }
    return { id: `hook-${i + 1}`, hook: clean(item), source_index: i };
  }).filter((c) => c.hook);
}

function corpusBonus(hook: string, corpus: HookJudgeCorpusHook[]): { bonus: number; reason: string | null } {
  const ht = new Set(tokens(hook));
  if (!ht.size || !corpus.length) return { bonus: 0, reason: null };
  let best = 0;
  for (const c of corpus.slice(0, 12)) {
    const text = clean(c.hook_text || c.text);
    if (!text) continue;
    const ct = tokens(text);
    if (!ct.length) continue;
    const overlap = ct.filter((t) => ht.has(t)).length / Math.max(4, Math.min(ht.size, ct.length));
    const viability = Math.max(1, Math.min(5, Number(c.viability_score ?? c.score ?? 1) || 1));
    best = Math.max(best, overlap * viability);
  }
  const bonus = Math.min(1.2, best * 0.45);
  return { bonus, reason: bonus >= 0.25 ? "похож на рабочий паттерн корпуса" : null };
}

function scoreOne(candidate: HookJudgeCandidate, corpus: HookJudgeCorpusHook[]): HookJudgeRanked {
  const h = candidate.hook;
  const lower = h.toLowerCase();
  const words = tokens(h);
  let score = 4.8;
  const reasons: string[] = [];

  if (words.length >= 4 && words.length <= 12) { score += 0.9; reasons.push("нормальная длина для первого экрана"); }
  else if (words.length < 3) { score -= 0.9; reasons.push("слишком коротко, не хватает смысла"); }
  else { score -= 0.6; reasons.push("длинновато для хука"); }

  const strong = STRONG_PATTERNS.filter((p) => p.test(h)).length;
  if (strong) { score += Math.min(1.8, strong * 0.7); reasons.push("есть pattern-break/тест/число"); }

  if (/[?]/.test(h) || /почему|что|как/i.test(h)) { score += 0.45; reasons.push("есть вопрос или curiosity gap"); }
  if (/\d/.test(h)) { score += 0.45; reasons.push("есть конкретика числом"); }
  if (/wb|wildberries|артикул|₽|руб/i.test(h)) { score -= 0.35; reasons.push("есть ранний коммерческий запах"); }

  const genericHits = GENERIC.filter((g) => lower.includes(g)).length;
  if (genericHits) { score -= Math.min(1.8, genericHits * 0.8); reasons.push("слишком общий рекламный заход"); }
  if (!/[а-яёa-z]/i.test(h)) { score -= 2; reasons.push("нет читаемого текста"); }

  const cb = corpusBonus(h, corpus);
  score += cb.bonus;
  if (cb.reason) reasons.push(cb.reason);

  const finalScore = Math.max(1, Math.min(10, Math.round(score * 10) / 10));
  return {
    ...candidate,
    score: finalScore,
    verdict: finalScore >= 7.2 ? "strong" : finalScore >= 5.8 ? "ok" : "weak",
    reasons: reasons.slice(0, 5),
  };
}

export function judgeHooks(input: { hooks?: unknown; candidates?: unknown; corpus?: HookJudgeCorpusHook[] }): HookJudgeResult {
  const candidates = normalizeCandidates(input.candidates ?? input.hooks);
  if (!candidates.length) return { ok: false, source: "deterministic", winner: null, ranked: [], corpus_used: 0, error: "нужны hooks или candidates" };
  const corpus = Array.isArray(input.corpus) ? input.corpus : [];
  const ranked = candidates.map((c) => scoreOne(c, corpus)).sort((a, b) => b.score - a.score || a.source_index - b.source_index);
  return { ok: true, source: "deterministic", winner: ranked[0] || null, ranked, corpus_used: corpus.length };
}
