export type SubmittedCategory = {
  category?: string | null;
  categoryConfirmed?: boolean;
};

/**
 * Нажатие «Сохранить» в интерактивном импорте подтверждает все видимые
 * заполненные статьи. Почтовый импорт работает без просмотра человеком и не
 * получает это подтверждение автоматически.
 */
export function submittedCategoryIsConfirmed(
  suggestion: SubmittedCategory,
  interactiveImport: boolean,
) {
  return interactiveImport && Boolean(String(suggestion.category ?? "").trim());
}
