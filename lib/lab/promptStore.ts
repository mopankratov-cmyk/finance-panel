// In-memory store задач генерации промпта (живёт в процессе сервера).
// Claude отвечает за секунды → генерим синхронно, кладём результат, лаба поллит статус.
export interface PromptTask {
  status: "done" | "error";
  prompt?: string;
  error?: string;
  audit?: { prompt_words?: number; images_total?: number };
  createdAt: number;
  inputs?: Record<string, unknown>; // для prompt-regenerate
}

const store = new Map<string, PromptTask>();
let _seq = 0;

export function newTaskId(): string {
  _seq += 1;
  return `${Date.now()}_${_seq}`;
}
export function putTask(id: string, t: PromptTask) {
  store.set(id, t);
  // лёгкая чистка старого (>1ч)
  if (store.size > 200) for (const [k, v] of store) if (Date.now() - v.createdAt > 3600000) store.delete(k);
}
export function getTask(id: string): PromptTask | null {
  return store.get(id) ?? null;
}
