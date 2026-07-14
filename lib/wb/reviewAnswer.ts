export type ReviewAnswerState = "unanswered" | "answered-with-text" | "answered-without-text";

export function reviewAnswerState(input: { isAnswered: boolean; answerText?: string | null }): ReviewAnswerState {
  if (input.answerText?.trim()) return "answered-with-text";
  return input.isAnswered ? "answered-without-text" : "unanswered";
}
