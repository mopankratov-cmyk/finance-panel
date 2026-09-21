import type { SupabaseClient } from "@supabase/supabase-js";
import { replaceCardCover } from "@/lib/wb/media";
import { needsPin, pinImageFromUrl, removePinned, resolveLiveCoverSource } from "./pinImage";

/**
 * Исходная обложка CTR-теста: закрепить на старте, вернуть на витрину в конце.
 *
 * Зачем — см. lib/ctrtest/pinImage.ts. Здесь две операции с общим смыслом:
 * витрина живой карточки принадлежит владельцу, а тест лишь берёт её взаймы.
 */

export const ORIGINAL_COVER_MIGRATION = "202609210001_ctr_test_original_cover.sql";

const columnMissing = (code?: string) => code === "42703" || code === "PGRST204";

type PrepareResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Подготовка черновика к запуску: копии вариантов и копия исходной обложки.
 *
 * Вызывается ОДИН раз, на первом старте, до того как крон коснулся витрины.
 * Только тогда обложка на карточке ещё исходная: после первой смены снять её
 * копию уже нечем.
 *
 * Варианты закрепляются и здесь, а не только при создании: у черновиков,
 * заведённых до этой защиты, в вариантах лежат живые ссылки на обложку.
 */
export async function prepareTestForStart(
  db: SupabaseClient,
  input: { testId: number; cabinetId: string; nmId: number },
  deps: { resolveSource: (nmId: number) => Promise<string | null> } = { resolveSource: resolveLiveCoverSource },
): Promise<PrepareResult> {
  const { data: variants, error: variantsError } = await db
    .from("ctr_variants").select("id, label, image_url").eq("test_id", input.testId).order("position", { ascending: true });
  if (variantsError) return { ok: false, error: variantsError.message, status: 500 };

  const created: string[] = [];
  const updates: { id: number; url: string }[] = [];
  const toPin = (variants ?? []).filter((variant) => needsPin(variant.image_url as string));
  const pinned = await Promise.all(toPin.map((variant) => pinImageFromUrl(db, {
    url: String(variant.image_url), cabinetId: input.cabinetId, nmId: input.nmId,
  })));
  for (const [index, result] of pinned.entries()) {
    if (!result.ok) {
      await removePinned(db, pinned.flatMap((entry) => (entry.ok ? [entry.path] : [])));
      return { ok: false, error: `Вариант «${toPin[index].label}»: ${result.error}. Тест не запущен.`, status: 502 };
    }
    created.push(result.path);
    updates.push({ id: Number(toPin[index].id), url: result.url });
  }

  const source = await deps.resolveSource(input.nmId);
  if (!source) {
    await removePinned(db, created);
    return { ok: false, error: "Не нашли обложку карточки на витрине WB — исходное фото нечем сохранить. Тест не запущен.", status: 502 };
  }
  const original = await pinImageFromUrl(db, { url: source, cabinetId: input.cabinetId, nmId: input.nmId });
  if (!original.ok) {
    await removePinned(db, created);
    return { ok: false, error: `Исходная обложка не сохранилась: ${original.error}. Тест не запущен.`, status: 502 };
  }
  created.push(original.path);

  // Колонки — первой записью: без них возвращать обложку некуда, и запускать
  // автосмену, которая её затрёт, нельзя.
  const saved = await db.from("ctr_tests")
    .update({ original_cover_url: original.url, cover_swapped_at: null, cover_restored_at: null })
    .eq("id", input.testId);
  if (saved.error) {
    await removePinned(db, created);
    return columnMissing(saved.error.code)
      ? { ok: false, error: `Примените миграцию ${ORIGINAL_COVER_MIGRATION}: без неё исходную обложку вернуть некуда.`, status: 503 }
      : { ok: false, error: saved.error.message, status: 500 };
  }

  for (const update of updates) {
    const result = await db.from("ctr_variants").update({ image_url: update.url }).eq("id", update.id);
    if (result.error) return { ok: false, error: result.error.message, status: 500 };
  }
  return { ok: true };
}

export type RestoreOutcome =
  | { status: "restored" }
  | { status: "skipped"; reason: "no-original" | "already-restored" | "never-swapped" | "migration-missing" }
  | { status: "failed"; error: string };

export interface RestoreDeps {
  replaceCover: (token: string, nmId: number, imageUrl: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Вернуть исходную обложку на витрину.
 *
 * Идемпотентна: пока `cover_restored_at` пуст, повтор допустим, и крон
 * повторяет его каждые пять минут. Витрина нужна владельцу прежней, поэтому
 * провал возврата не терпится молча — он остаётся в очереди и виден на экране.
 */
export async function restoreOriginalCover(
  db: SupabaseClient,
  test: { id: number; nm_id: number },
  contentToken: string,
  actor: string,
  deps: RestoreDeps = { replaceCover: replaceCardCover },
): Promise<RestoreOutcome> {
  const { data: row, error } = await db.from("ctr_tests")
    .select("original_cover_url, cover_swapped_at, cover_restored_at").eq("id", test.id).maybeSingle();
  if (error) {
    return columnMissing(error.code) ? { status: "skipped", reason: "migration-missing" } : { status: "failed", error: error.message };
  }
  if (!row?.original_cover_url) return { status: "skipped", reason: "no-original" };
  if (row.cover_restored_at) return { status: "skipped", reason: "already-restored" };
  // Крон ставит метку сразу после успешной записи в карточку. Нет метки —
  // витрина не менялась, и перезаливать обложку значило бы зря гонять её через
  // повторное сжатие WB.
  if (!row.cover_swapped_at) return { status: "skipped", reason: "never-swapped" };

  const write = await deps.replaceCover(contentToken, Number(test.nm_id), String(row.original_cover_url));
  if (!write.ok) return { status: "failed", error: write.error };

  await db.from("ctr_tests").update({ cover_restored_at: new Date().toISOString() }).eq("id", test.id);
  await db.from("ctr_test_events").insert({
    test_id: test.id,
    action: "cover_restored",
    actor,
    details: { url: row.original_cover_url },
  });
  return { status: "restored" };
}
