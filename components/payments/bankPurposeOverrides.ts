import type { BankSuggestion } from "./bankAutoClassify";

export function applyBankPurposes(
  suggestions: BankSuggestion[],
  overrides: ReadonlyMap<string, string>,
): BankSuggestion[] {
  return suggestions.map((suggestion) => overrides.has(suggestion.row.id) ? {
    ...suggestion,
    row: { ...suggestion.row, purpose: overrides.get(suggestion.row.id)!.trim() },
  } : suggestion);
}
