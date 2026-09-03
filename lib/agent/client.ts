import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODEL } from "@/lib/ai/models";

/**
 * Создаёт Anthropic-клиент. На этой машине прямой доступ к api.anthropic.com
 * заблокирован — выход только через локальный прокси (AGENT_PROXY_URL). Глобальный
 * fetch Node прокси не использует, поэтому подключаем undici.ProxyAgent через
 * собственный fetch из той же npm-копии undici.
 */
export async function createClaudeClient(): Promise<Anthropic | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const proxyUrl =
    process.env.AGENT_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  let customFetch: typeof fetch | undefined;
  if (proxyUrl) {
    try {
      const undici = await import("undici");
      const dispatcher = new undici.ProxyAgent(proxyUrl);
      customFetch = ((url: string | URL | Request, init?: RequestInit) =>
        (undici.fetch as unknown as typeof fetch)(url, {
          ...init,
          // @ts-expect-error undici-специфичная опция
          dispatcher,
        })) as typeof fetch;
    } catch {
      /* без прокси — пойдёт напрямую */
    }
  }

  return new Anthropic({ apiKey, fetch: customFetch });
}

// Модель указана в ТЗ (раздел 5.7)
export const CLAUDE_MODEL = ANTHROPIC_MODEL;
