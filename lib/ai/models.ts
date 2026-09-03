// Одна модель Anthropic для всех вызовов ИИ в панели: договоры, PDF-выписки,
// ответы руководителя в Telegram, AI-агент. Решение владельца 03.09.2026 —
// всё на Opus 5. Меняется в одном месте или переменной окружения.
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
