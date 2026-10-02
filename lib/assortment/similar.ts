/**
 * Похожие модели по фото. Чистые функции.
 *
 * Сходство по фото — подсказка «посмотрите рядом», а не доказательство одной
 * модели (ТЗ §6): показываем процент и подпись, связей «идентична» не делаем.
 */

export const EMBEDDING_DIM = 512;
/** Косинусное расстояние, дальше которого «похожей» не называем. */
export const MAX_DISTANCE = 0.3;

export function similarityPercent(distance: number): number {
  return Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
}

export class EmbeddingInputError extends Error {}

export interface EmbeddingIngest {
  model: string;
  items: Array<{ mediaId: string; embedding: string }>;
  failed: Array<{ mediaId: string; error: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Проверка посылки сборщика: 512 конечных чисел на фото; вектор — в текст pgvector. */
export function parseEmbeddingIngest(raw: unknown): EmbeddingIngest {
  const body = (raw ?? {}) as { model?: unknown; items?: unknown; failed?: unknown };
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model || model.length > 120) throw new EmbeddingInputError("Не указана модель отпечатков.");
  const items = Array.isArray(body.items) ? body.items : [];
  const failed = Array.isArray(body.failed) ? body.failed : [];
  if (items.length + failed.length > 100) throw new EmbeddingInputError("За раз — не больше 100 фото.");
  return {
    model,
    items: items.map((item) => {
      const { mediaId, embedding } = (item ?? {}) as { mediaId?: unknown; embedding?: unknown };
      if (typeof mediaId !== "string" || !UUID.test(mediaId)) throw new EmbeddingInputError("Неверный mediaId.");
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM || !embedding.every((x) => typeof x === "number" && Number.isFinite(x))) {
        throw new EmbeddingInputError(`Отпечаток должен быть из ${EMBEDDING_DIM} чисел.`);
      }
      return { mediaId, embedding: `[${(embedding as number[]).join(",")}]` };
    }),
    failed: failed.map((item) => {
      const { mediaId, error } = (item ?? {}) as { mediaId?: unknown; error?: unknown };
      if (typeof mediaId !== "string" || !UUID.test(mediaId)) throw new EmbeddingInputError("Неверный mediaId.");
      return { mediaId, error: typeof error === "string" && error.trim() ? error.slice(0, 300) : "фото не прочиталось" };
    }),
  };
}
