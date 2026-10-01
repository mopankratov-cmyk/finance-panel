import { NextResponse } from "next/server";
import { CollectionInputError } from "./collections";
import { CollectionNotFoundError } from "./collectionsStore";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Единый ответ роутов подборок на ошибку: 400/404/503 по смыслу, иначе 500. */
export function collectionFailure(error: unknown) {
  if (error instanceof CollectionNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof CollectionInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка подборки" }, { status: 500 });
}
