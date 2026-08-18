// Штрафы и удержания WB — из детализации финансового отчёта (Finance API,
// sales-reports/detailed). Отдельной «ручки штрафов» у WB нет: штраф живёт
// строкой отчёта с ненулевыми `penalty` / `deduction` и текстовым обоснованием
// `bonus_type_name`. Здесь мы только отбираем такие строки и раскладываем их по
// смысловым группам — ничего не досчитываем и не восстанавливаем.
//
// Важно про честность цифр: поля-классификатора у WB нет, группы собраны
// поиском подстрок в тексте причины. Поэтому итог модуля — это итог ВЫБОРКИ,
// а не отчётная сумма удержаний кабинета. Всё, что выборка отбросила
// (реклама/продвижение и строки вне товарного контура), не исчезает молча:
// оно считается и отдаётся отдельно в `exclusions`, чтобы экран мог сказать
// пользователю, какой суммы он не видит.
//
// Рекламные удержания исключаются тем же правилом, что и в lib/wb/commissions.ts:
// продвижение — это не штраф склада, оно живёт в рекламном контуре.

import { fetchWbReportPage, WbReportDeadlineError } from "./reportPagination";
import { allowsBrand, isScoped, normalizeWbBrand, type WbProductScope } from "./productScope";

/** Смысловая группа удержания — по тексту обоснования WB. */
export type WbPenaltyGroup = "dimensions" | "measurement" | "substitution" | "other";

export interface WbPenaltyRow {
  rrdId: number;
  /** Дата строки отчёта (YYYY-MM-DD) либо null, если WB её не отдал. */
  date: string | null;
  nmId: number | null;
  article: string;
  brand: string | null;
  /** Обоснование удержания (bonus_type_name) — как его написал WB. */
  reason: string;
  /** Операция отчёта (supplier_oper_name). */
  operation: string;
  penalty: number;
  deduction: number;
  total: number;
  group: WbPenaltyGroup;
}

export interface WbPenaltySummary {
  group: WbPenaltyGroup;
  label: string;
  amount: number;
  rows: number;
}

export const WB_PENALTY_GROUP_LABELS: Record<WbPenaltyGroup, string> = {
  dimensions: "Штрафы за габариты",
  measurement: "Замеры склада",
  substitution: "Подмены и вложения",
  other: "Прочие удержания",
};

const PENALTY_REPORT_FIELDS = [
  "rrdId",
  "rrDate",
  "nmId",
  "vendorCode",
  "brandName",
  "sellerOperName",
  "bonusTypeName",
  "penalty",
  "deduction",
] as const;

/** Строка отчёта в snake_case — reportPagination нормализует имена сам. */
interface PenaltyReportRow {
  rrd_id?: number;
  rr_dt?: string;
  nm_id?: number;
  sa_name?: string;
  brand_name?: string;
  supplier_oper_name?: string;
  bonus_type_name?: string;
  penalty?: number;
  deduction?: number;
}

/** Потолок страховки от бесконечного курсора — тот же порядок, что в reportPagination. */
const MAX_REPORT_PAGES = 1_000;

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown) => String(value ?? "").trim();

/** Реклама/продвижение — не штраф склада: у неё свой контур расходов. */
function isAdvertDeduction(reason: string): boolean {
  const lowered = reason.toLowerCase();
  return lowered.includes("продвижени") || lowered.includes("реклам");
}

export function classifyPenaltyReason(bonusTypeName: string): WbPenaltyGroup {
  const lowered = bonusTypeName.toLowerCase();
  if (lowered.includes("габарит") || lowered.includes("размер") || lowered.includes("объём") || lowered.includes("объем")) {
    return "dimensions";
  }
  if (lowered.includes("замер") || lowered.includes("перемер") || lowered.includes("контрол")) return "measurement";
  if (
    lowered.includes("подмен")
    || lowered.includes("вложени")
    || lowered.includes("недостач")
    || lowered.includes("пересорт")
  ) {
    return "substitution";
  }
  return "other";
}

function normalizeDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Проверка товарного контура на Set. Логика — та же, что в allowsProduct():
 * пришёл бренд — решает бренд, бренда нет — решает allowlist nmID. Отличие
 * только в цене: allowsProduct() ищет nmID перебором массива, а через этот
 * фильтр проходит до 100 000 строк детализации на каждой странице.
 */
function scopeFilter(scope: WbProductScope): (nmId: unknown, brand: unknown) => boolean {
  if (!isScoped(scope)) return () => true;
  const allowedNmIds = new Set(scope.allowedNmIds ?? []);
  return (nmId, brand) => {
    if (normalizeWbBrand(brand)) return allowsBrand(scope, brand);
    const nm = Number(nmId);
    return Number.isFinite(nm) && allowedNmIds.has(nm);
  };
}

function toPenaltyRow(row: PenaltyReportRow, penalty: number, deduction: number, reason: string): WbPenaltyRow {
  const nmId = Number(row.nm_id ?? 0);
  const brand = text(row.brand_name);
  return {
    rrdId: num(row.rrd_id),
    date: normalizeDate(row.rr_dt),
    // Удержание может быть account-level — без nm_id. Это не «ноль», а «не по товару».
    nmId: Number.isFinite(nmId) && nmId > 0 ? nmId : null,
    article: text(row.sa_name),
    brand: brand || null,
    reason,
    operation: text(row.supplier_oper_name),
    penalty,
    deduction,
    total: penalty + deduction,
    group: classifyPenaltyReason(reason),
  };
}

export function summarizePenalties(rows: WbPenaltyRow[]): WbPenaltySummary[] {
  const groups: WbPenaltyGroup[] = ["dimensions", "measurement", "substitution", "other"];
  return groups.map((group) => {
    const own = rows.filter((row) => row.group === group);
    return {
      group,
      label: WB_PENALTY_GROUP_LABELS[group],
      amount: own.reduce((sum, row) => sum + row.total, 0),
      rows: own.length,
    };
  });
}

export interface WbPenaltiesOptions {
  token: string;
  dateFrom: string;
  dateTo: string;
  scope: WbProductScope;
  /** Абсолютный дедлайн (Date.now()-шкала) — по нему отдаём собранное, а не падаем. */
  deadlineMs?: number;
}

/** Что выборка отбросила — считаем, а не выкидываем молча. */
export interface WbPenaltyExclusions {
  /** Строки «реклама/продвижение»: это не штрафы склада, у них свой контур расходов. */
  advertRows: number;
  advertAmount: number;
  /** Строки вне товарного контура кабинета — в том числе удержания уровня кабинета без nm_id. */
  outOfScopeRows: number;
  outOfScopeAmount: number;
}

export interface WbPenaltiesResult {
  rows: WbPenaltyRow[];
  summary: WbPenaltySummary[];
  /** Сумма показанных строк — итог ВЫБОРКИ, а не всех удержаний кабинета. */
  total: number;
  /** false — отчёт не догружен до конца: показанное меньше фактического. */
  complete: boolean;
  /** Почему выгрузка неполная; null — дочитали отчёт до конца. */
  incompleteReason: string | null;
  exclusions: WbPenaltyExclusions;
}

/**
 * Удержания кабинета за период. Неполная выгрузка — это `complete: false` с уже
 * собранными строками и причиной в `incompleteReason`, а не ошибка: половина
 * правды полезнее пустого экрана, но подписана честно. Единственное исключение —
 * когда собрать не удалось вообще ничего и виноват не дедлайн: показывать нечего,
 * и ошибка WB уходит наверх, чтобы экран не соврал «удержаний нет».
 */
export async function fetchWbPenalties(options: WbPenaltiesOptions): Promise<WbPenaltiesResult> {
  const { token, dateFrom, dateTo, scope, deadlineMs } = options;
  const rows: WbPenaltyRow[] = [];
  const seen = new Set<number>();
  const exclusions: WbPenaltyExclusions = { advertRows: 0, advertAmount: 0, outOfScopeRows: 0, outOfScopeAmount: 0 };
  const allowsProductFast = scopeFilter(scope);
  let complete = false;
  let incompleteReason: string | null = null;
  let cursor = 0;

  // Пагинируем постранично сами: fetchWbReportPages на дедлайне теряет уже
  // собранные страницы вместе со стеком, а нам они нужны — из них и состоит
  // «частично загружено».
  try {
    for (let page = 0; page < MAX_REPORT_PAGES; page++) {
      const result = await fetchWbReportPage<PenaltyReportRow>({
        token,
        dateFrom,
        dateTo,
        period: "weekly",
        fields: [...PENALTY_REPORT_FIELDS],
        initialRrdId: cursor,
        deadlineMs,
      });
      if (result.complete) {
        complete = true;
        break;
      }
      for (const raw of result.rows) {
        const rrdId = Number(raw.rrd_id ?? 0);
        if (rrdId > 0) {
          if (seen.has(rrdId)) continue;
          seen.add(rrdId);
        }
        const penalty = num(raw.penalty);
        const deduction = num(raw.deduction);
        // Строка без удержания — просто не про этот экран, считать её нечего.
        if (penalty === 0 && deduction === 0) continue;
        const reason = text(raw.bonus_type_name);
        if (isAdvertDeduction(reason)) {
          exclusions.advertRows += 1;
          exclusions.advertAmount += penalty + deduction;
          continue;
        }
        if (!allowsProductFast(raw.nm_id, raw.brand_name)) {
          exclusions.outOfScopeRows += 1;
          exclusions.outOfScopeAmount += penalty + deduction;
          continue;
        }
        rows.push(toPenaltyRow(raw, penalty, deduction, reason));
      }
      cursor = result.lastRrdId;
    }
    if (!complete && !incompleteReason) {
      incompleteReason = `Отчёт длиннее ${MAX_REPORT_PAGES} страниц — прочитана только его часть`;
    }
  } catch (error) {
    // Обещание модуля: собранное не теряем ни на дедлайне, ни на обрыве WB.
    // Но если не собрано ничего и виноват не дедлайн — показывать нечего,
    // и пустой экран соврал бы «удержаний нет»: отдаём ошибку наверх.
    if (!(error instanceof WbReportDeadlineError) && rows.length === 0) throw error;
    incompleteReason = error instanceof WbReportDeadlineError
      ? "Время на выгрузку финансового отчёта вышло — прочитана только часть периода"
      : error instanceof Error
        ? `WB прервал выгрузку отчёта: ${error.message}`
        : "WB прервал выгрузку финансового отчёта";
  }

  rows.sort((a, b) => {
    const dateDiff = (b.date ?? "").localeCompare(a.date ?? "");
    if (dateDiff !== 0) return dateDiff;
    return Math.abs(b.total) - Math.abs(a.total);
  });

  return {
    rows,
    summary: summarizePenalties(rows),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    complete,
    incompleteReason,
    exclusions,
  };
}
