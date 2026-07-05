type OutcomeGuardrailInput = {
  outcome_status?: string;
  outcome_confidence?: string;
  outcome_posts?: number;
  outcome_winners?: number;
  outcome_losers?: number;
  outcome_trust_action?: string;
  outcome_evidence?: string;
  platform?: string;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function uniq(items: string[], limit = 6) {
  return Array.from(new Set(items.map((item) => text(item)).filter(Boolean))).slice(0, limit);
}

export function buildReelsBrainOutcomeGuardrails(input: OutcomeGuardrailInput) {
  const status = text(input.outcome_status, "no_feedback");
  const posts = num(input.outcome_posts);
  const winners = num(input.outcome_winners);
  const losers = num(input.outcome_losers);
  const confidence = text(input.outcome_confidence, "none");
  const trustAction = text(input.outcome_trust_action);
  const evidence = text(input.outcome_evidence);
  const platform = text(input.platform);

  const antiPatterns = status === "weak"
    ? [
      {
        label: "Weak segment outcome",
        severity: losers >= 2 ? "high" : "medium",
        reason: losers >= 2
          ? `Сегмент уже словил ${losers} loser-posts и рынок не подтвердил текущую механику.`
          : "Сегмент пока не подтвердился outcome-публикациями.",
        action: trustAction || "review_or_penalize_segment",
      },
    ]
    : status === "promising"
      ? [
        {
          label: "Outcome still forming",
          severity: "medium",
          reason: `Есть только первые market signals (${posts} posts), значит сегмент нельзя считать доказанным.`,
          action: trustAction || "keep_validating_segment",
        },
      ]
      : [];

  const guardrails = uniq([
    status === "weak" ? "Не пускать текущую механику в основной generation lane до пересборки hook/structure." : "",
    status === "weak" && losers >= 2 ? "Не масштабировать сегмент, пока новый control не покажет выход из loser-зоны." : "",
    status === "promising" ? "Запускать только как control-ready гипотезу, не как готовый primary recipe." : "",
    status === "proven" && confidence === "high" ? "Масштабировать механику, но не копировать literal execution референсов." : "",
    evidence ? `Outcome evidence: ${evidence}` : "",
  ]);

  const doNotCopy = uniq([
    status === "weak" ? "текущий слабый hook без пересборки" : "",
    status === "weak" ? "тот же opening beat и pacing, который уже не сработал на рынке" : "",
    status === "weak" && platform ? `не повторять weak ${platform} execution 1-in-1` : "",
    status === "promising" ? "не считать текущую механику доказанной до следующего control" : "",
  ], 5);

  return {
    status,
    anti_patterns: antiPatterns,
    guardrails,
    do_not_copy: doNotCopy,
  };
}

