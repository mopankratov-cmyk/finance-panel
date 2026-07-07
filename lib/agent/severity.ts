// agent_insights.severity приходит из трёх разных источников с разным словарём:
// lib/agent/rules.ts → high/medium/low, lib/signals/classify.ts → danger/warn/info,
// плюс исторические критично/важно/инфо-строки. Единая шкала для отображения.
export type SeverityTier = "critical" | "warning" | "info";

const TIER: Record<string, SeverityTier> = {
  high: "critical", danger: "critical", critical: "critical",
  medium: "warning", warn: "warning", warning: "warning",
  low: "info", info: "info",
};

export function normalizeSeverity(raw: string): SeverityTier {
  return TIER[raw] ?? "info";
}

export const SEVERITY_LABEL: Record<SeverityTier, string> = {
  critical: "Критично",
  warning: "Важно",
  info: "Инфо",
};
