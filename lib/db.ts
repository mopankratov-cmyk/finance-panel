import type { FinanceAction, FinanceState } from "./types";

async function apiJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

export async function loadFinanceState(): Promise<FinanceState> {
  return fetch("/api/finance/state", { cache: "no-store" }).then(apiJson<FinanceState>);
}

export async function persistFinanceAction(
  action: FinanceAction,
  prevState: FinanceState,
  nextState: FinanceState,
): Promise<void> {
  await fetch("/api/finance/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, prevState, nextState }),
  }).then(apiJson<{ ok: boolean }>);
}
