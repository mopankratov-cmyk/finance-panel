// Модель Anthropic (прямой вызов) для AI-агента и ИИ-признаков ассортимента.
// Решение владельца 03.09.2026 — Opus 5. Меняется в одном месте или env.
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Финансовое распознавание (договоры, банковские выписки, классификация платежей)
// идёт через «Пользу» (polza.ai), оплата в рублях. Решение владельца 07.10.2026 —
// главная модель Claude Opus 4.8; при её сбое — резервная. Слаги — как в каталоге
// polza.ai/api/v1/models (через точку: claude-opus-4.8, не -4-8). Меняется env.
export const POLZA_FINANCE_MODEL = process.env.POLZA_FINANCE_MODEL?.trim() || "anthropic/claude-opus-4.8";
export const POLZA_FINANCE_FALLBACK_MODEL = process.env.POLZA_FINANCE_FALLBACK_MODEL?.trim() || "openai/gpt-4o";
