"use client";

import { deploymentPinnedFetch } from "@/lib/http/deploymentPinnedFetch";
import { readApiResponse } from "@/lib/http/readApiResponse";

/**
 * Один способ звать управляющие роуты рекламы.
 *
 * Отдельный слой нужен из-за характера этих вызовов: они меняют деньги, и у
 * ошибки здесь другая цена, чем у неудавшегося чтения. Поэтому «ок» никогда не
 * выводится из HTTP-статуса — только из явного `ok` в теле. Роут, который упал
 * после успешной записи в WB, вернёт не-200, но действие уже произошло; молча
 * показать «не получилось» значит спровоцировать повтор той же операции.
 */
export interface AdActionResult<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

async function call<T>(url: string, init: RequestInit): Promise<AdActionResult<T>> {
  try {
    const response = await deploymentPinnedFetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    const body = await readApiResponse<{ error?: string; ok?: boolean } & Record<string, unknown>>(response, "Реклама WB");
    if (body.error) return { ok: false, error: body.error, data: null };
    if (!response.ok) return { ok: false, error: `Запрос не прошёл (${response.status})`, data: null };
    return { ok: true, error: null, data: body as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Сеть недоступна", data: null };
  }
}

export function adPost<T>(path: string, body: unknown) {
  return call<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function adDelete<T>(path: string, body: unknown) {
  return call<T>(path, { method: "DELETE", body: JSON.stringify(body) });
}

export function adGet<T>(path: string) {
  return call<T>(path, { method: "GET" });
}

/* ------------------------------------------------------------------ */

export interface AdCabinetConfig {
  cabinet: { id: string; name: string };
  token: {
    sandbox: boolean;
    host: string;
    expiresAt: string | null;
    daysLeft: number | null;
    isExpired: boolean;
    promotionAvailable: boolean;
    promotionError: string | null;
  };
  config: { currency: string; cpmStepRub: number; cpcStepRub: number; minTopUpRub: number } | null;
  money: { account: number; net: number; bonus: number; currency: string } | null;
  moneyError: string | null;
  depositAllowance: {
    spentToday: number;
    maxPerOperation: number;
    maxPerDay: number;
    remainingToday: number;
  } | null;
}

export interface AdJournalEntry {
  id: number;
  advertId: number;
  advertName: string | null;
  action: string;
  actionLabel: string;
  status: string;
  userEmail: string | null;
  oldValue: unknown;
  newValue: unknown;
  detail: string | null;
  createdAt: string;
}

export interface AdRule {
  id: string;
  advertId: number;
  nmId: number | null;
  placement: string;
  goal: "drr" | "cpo";
  target: number;
  windowDays: number;
  stepPercent: number;
  minBid: number;
  maxBid: number;
  minOrders: number;
  enabled: boolean;
  createdBy: string | null;
  updatedAt: string;
  lastRun: { ran_at: string; decision: string; old_bid: number | null; new_bid: number | null; reason: string | null } | null;
}

export interface AdCluster {
  query: string;
  bid: number | null;
}

export const money = (value: number | null | undefined, currency = "₽") =>
  value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ${currency}`;
