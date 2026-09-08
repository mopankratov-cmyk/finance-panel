import { CTR_MIN_VIEWS } from "@/lib/wb/ctrQuality";

export type CtrTestType = "ctr" | "cr" | "video";
export type CtrTestStatus = "draft" | "running" | "paused" | "done" | "cancelled";

export interface CtrMetricSnapshot {
  impressions: number;
  clicks: number;
  spend: number;
  opens: number;
  carts: number;
  orders: number;
  capturedAt: string;
}

export interface CtrVariantTotals {
  id: number;
  position: number;
  label: string;
  isBaseline: boolean;
  impressions: number;
  clicks: number;
  spend: number;
  opens: number;
  carts: number;
  orders: number;
  roundsCount: number;
  roundsWon: number;
}

export interface CtrCreateInput {
  cabinetId: string;
  nmId: number;
  article: string;
  name: string;
  testType: CtrTestType;
  intervalMin: number;
  impressionsPerRound: number;
  targetImpressions: number;
  spendCapRub: number;
  sourceTestId: number | null;
  variants: { label: string; imageUrl: string; source: string; isBaseline: boolean }[];
}

type NormalizeResult = { ok: true; value: CtrCreateInput } | { ok: false; error: string };

const finite = (value: unknown) => Number(value);
const clean = (value: unknown, max = 255) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

function integer(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function money(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed * 100) / 100 : null;
}

export function normalizeCtrCreatePayload(raw: Record<string, unknown>): NormalizeResult {
  const cabinetId = clean(raw.cabinetId, 80);
  const nmId = integer(raw.nmId, 1, Number.MAX_SAFE_INTEGER);
  const testType = clean(raw.testType, 20) as CtrTestType;
  const intervalMin = integer(raw.intervalMin, 5, 1_440);
  const impressionsPerRound = integer(raw.impressionsPerRound, 10, 1_000_000);
  const targetImpressions = integer(raw.targetImpressions, 100, 10_000_000);
  const spendCapRub = money(raw.spendCapRub, 100, 1_000_000);
  const sourceTestId = raw.sourceTestId == null ? null : integer(raw.sourceTestId, 1, Number.MAX_SAFE_INTEGER);
  if (!cabinetId || cabinetId === "all" || cabinetId.startsWith("group:")) return { ok: false, error: "Выберите один реальный WB-кабинет" };
  if (!nmId) return { ok: false, error: "Укажите корректный nmId" };
  if (!["ctr", "cr", "video"].includes(testType)) return { ok: false, error: "Неизвестный тип теста" };
  if (!intervalMin) return { ok: false, error: "Интервал должен быть от 5 минут до 24 часов" };
  if (!impressionsPerRound) return { ok: false, error: "Показы за раунд должны быть от 10 до 1 000 000" };
  if (!targetImpressions) return { ok: false, error: "Цель должна быть от 100 до 10 000 000 показов" };
  if (spendCapRub === null) return { ok: false, error: "Лимит расходов должен быть от 100 до 1 000 000 ₽" };
  if (raw.sourceTestId != null && !sourceTestId) return { ok: false, error: "Некорректный исходный тест маховика" };

  const sourceVariants = Array.isArray(raw.variants) ? raw.variants : [];
  if (sourceVariants.length < 2 || sourceVariants.length > 6) return { ok: false, error: "В тесте должно быть от 2 до 6 вариантов" };
  const variants = sourceVariants.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      label: clean(row.label, 80) || `Вариант ${String.fromCharCode(65 + index)}`,
      imageUrl: clean(row.imageUrl, 2_000),
      source: clean(row.source, 40) || (index === 0 ? "current" : "link"),
      isBaseline: row.isBaseline === true || index === 0,
    };
  });
  if (variants.some((variant) => {
    try { return new URL(variant.imageUrl).protocol !== "https:"; } catch { return true; }
  })) return { ok: false, error: "Каждый вариант должен содержать HTTPS-ссылку на контент" };
  if (new Set(variants.map((variant) => variant.imageUrl)).size !== variants.length) return { ok: false, error: "Одинаковый контент нельзя добавить дважды" };
  variants.forEach((variant, index) => { variant.isBaseline = index === 0; });

  return {
    ok: true,
    value: {
      cabinetId,
      nmId,
      article: clean(raw.article, 255) || String(nmId),
      name: clean(raw.name, 255),
      testType,
      intervalMin,
      impressionsPerRound,
      targetImpressions,
      spendCapRub,
      sourceTestId,
      variants,
    },
  };
}

const metric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function normalizeCtrSnapshot(raw: Partial<CtrMetricSnapshot>): CtrMetricSnapshot {
  return {
    impressions: Math.round(metric(raw.impressions)),
    clicks: Math.round(metric(raw.clicks)),
    spend: Math.round(metric(raw.spend) * 100) / 100,
    opens: Math.round(metric(raw.opens)),
    carts: Math.round(metric(raw.carts)),
    orders: Math.round(metric(raw.orders)),
    capturedAt: clean(raw.capturedAt, 80) || new Date().toISOString(),
  };
}

export function ctrSnapshotDelta(baselineRaw: Partial<CtrMetricSnapshot>, currentRaw: Partial<CtrMetricSnapshot>) {
  const baseline = normalizeCtrSnapshot(baselineRaw);
  const current = normalizeCtrSnapshot(currentRaw);
  const corrected = (["impressions", "clicks", "spend", "opens", "carts", "orders"] as const).some((key) => current[key] < baseline[key]);
  return {
    impressions: Math.max(0, current.impressions - baseline.impressions),
    clicks: Math.max(0, current.clicks - baseline.clicks),
    spend: Math.round(Math.max(0, current.spend - baseline.spend) * 100) / 100,
    opens: Math.max(0, current.opens - baseline.opens),
    carts: Math.max(0, current.carts - baseline.carts),
    orders: Math.max(0, current.orders - baseline.orders),
    capturedAt: current.capturedAt,
    corrected,
  };
}

/**
 * Доля варианта для ПОКАЗА на экране. `null` — знаменателя не хватает.
 *
 * На десятке показов доля скачет на десятки процентов, поэтому ниже
 * CTR_MIN_VIEWS процент не рисуется вовсе — иначе «CTR 50%» с двух показов
 * читается как результат.
 *
 * Победителя эта функция НЕ выбирает и никогда не выбирала: решение принимает
 * SQL-функция transition_ctr_test, и порог теперь стоит там же
 * (supabase/migrations/202608310002_ctr_winner_threshold.sql). Здесь жили ещё
 * chooseCtrWinner и ctrWinnerExplanation — их не вызывал никто, а комментарий
 * рядом уверял, что порог применяется к победителю теста. Дублировать правило
 * в двух местах, где работает только одно, хуже, чем не иметь второго.
 */
export function ctrVariantScore(type: CtrTestType, variant: Pick<CtrVariantTotals, "impressions" | "clicks" | "opens" | "carts" | "orders">): number | null {
  const numerator = type === "ctr" ? variant.clicks : type === "cr" ? variant.carts : variant.orders;
  const denominator = type === "ctr" ? variant.impressions : variant.opens;
  return denominator >= CTR_MIN_VIEWS ? numerator / denominator * 100 : null;
}

/**
 * Метка отказа, который человек может снять сам, подтвердив досрочное
 * закрытие теста. Роут ставит её в начало сообщения, экран по ней узнаёт
 * отказ и предлагает повтор с force. Без этой связки страж «равных показов»
 * запирал кнопку «Стоп с победителем» снаружи: SQL требовал force, а
 * отправить его было нечем.
 */
export const CTR_FORCE_HINT = "Варианты открутились неодинаково — сравнивать их пока нечестно.";

/**
 * Что тест сможет различить и сколько продлится.
 *
 * Порог различимости — обычная формула для двух долей (95% уверенности, 80%
 * мощности): n ≈ 16·p(1−p)/Δ². Отсюда Δ — абсолютная разница в CTR, которую
 * выборка размером n ещё различает, а Δ/p — она же в относительном виде, в
 * котором про обложки и думают («лучше на четверть»).
 *
 * Нужна эта оценка затем, что цель «1000 показов» выглядит так же солидно,
 * как «5000», хотя при среднем CTR около 4% на первой различима только
 * разница в 60% — то есть почти любой итог случаен. Число в поле об этом
 * молчит, а строка под полями говорит.
 *
 * Срок считается по показам самого товара за известное окно. Не знаем
 * трафика — не выдумываем срок.
 */
export function ctrTestForecast(input: {
  targetImpressions: number;
  variantCount: number;
  ctrPercent: number | null;
  viewsInWindow: number | null;
  windowDays: number;
}): { detectableShare: number | null; days: number | null; text: string } {
  const p = ((input.ctrPercent ?? 0) > 0 ? Number(input.ctrPercent) : 4.3) / 100;
  const n = Math.max(0, Math.floor(input.targetImpressions));
  const detectableShare = n > 0 && p > 0 && p < 1 ? Math.sqrt((16 * p * (1 - p)) / n) / p : null;

  const perDay = input.viewsInWindow && input.windowDays > 0 ? input.viewsInWindow / input.windowDays : 0;
  const needed = n * Math.max(1, input.variantCount);
  const days = perDay > 0 ? needed / perDay : null;

  const readable = detectableShare == null
    ? null
    : detectableShare <= 0.15
      ? `различит разницу примерно от ${Math.round(detectableShare * 100)}% — хватит и на тонкие отличия`
      : detectableShare <= 0.35
        ? `различит разницу примерно от ${Math.round(detectableShare * 100)}% — обычный рабочий уровень для обложки`
        : `различит только разницу от ${Math.round(detectableShare * 100)}%, то есть почти любой итог будет случайным: поднимите «показов на вариант»`;

  const duration = days == null
    ? "срок зависит от того, сколько реклама даст показов"
    : days < 1
      ? `на трафике товара это около ${Math.max(1, Math.round(days * 24))} ч`
      : days < 2
        ? "на трафике товара это около суток"
        : `на трафике товара это около ${Math.round(days)} суток`;

  const text = readable ? `Тест ${readable}. При ${Math.max(1, input.variantCount)} вариантах ${duration}.` : duration;
  return { detectableShare, days, text };
}

/**
 * Можно ли уже принимать решение по тесту.
 *
 * Чужие сервисы отвечают на это правилом большого пальца: «наберите 10 000
 * показов, тогда погрешность минимальна». Правило удобное, но неверное:
 * нужный объём зависит от того, НАСКОЛЬКО варианты разошлись. Если лидер
 * впереди вдвое, хватит и тысячи; если на пять процентов — не хватит и
 * пятидесяти тысяч.
 *
 * Поэтому считаем не «сколько набрать», а «различима ли уже та разница,
 * которая получилась». Порог различимости — та же формула для двух долей,
 * что и в прогнозе мастера (16·p(1−p)/Δ²), только n берётся фактический:
 * меньший из объёмов лидера и второго места, потому что сравнение не
 * надёжнее своей слабой стороны.
 *
 * Возвращает null, когда сравнивать нечего: меньше двух вариантов с
 * достаточным числом показов.
 */
/**
 * Различима ли разница между двумя конкретными вариантами.
 *
 * Формула та же, что в прогнозе мастера (16·p(1−p)/Δ²), но вынесена в одно
 * место, потому что порог у каждой ПАРЫ свой. На трёх и более вариантах общий
 * порог, посчитанный по лидеру и второму месту, для третьего просто неверен:
 * вариант с тысячей показов и вариант с восемью тысячами меряются разными
 * линейками, и красить их одной значило бы называть доказанным то, что не
 * измерено. n берётся меньший из двух: сравнение не надёжнее своей слабой
 * стороны.
 *
 * `progress` — доля набранной выборки от необходимой. Различимая разница
 * падает как 1/sqrt(n), поэтому отношение «разрыв к порогу» в квадрате и есть
 * эта доля, а `needSample` — оценка «сколько показов нужно». Оценка честна
 * при одном допущении, и его надо называть вслух: разрыв должен сохраниться.
 * Когда варианты идут вровень, нужной выборки не существует — там честный
 * ответ не число, а null.
 */
export function ctrGapVerdict(
  leader: { impressions: number; clicks: number },
  other: { impressions: number; clicks: number },
): { gapShare: number; detectableShare: number; decisive: boolean; sample: number; progress: number; needSample: number | null } | null {
  const sample = Math.min(leader.impressions, other.impressions);
  if (sample <= 0 || leader.impressions <= 0 || other.impressions <= 0) return null;
  const leaderCtr = leader.clicks / leader.impressions;
  const otherCtr = other.clicks / other.impressions;
  if (leaderCtr <= 0 || leaderCtr >= 1) return null;

  const gapShare = (leaderCtr - otherCtr) / (otherCtr || leaderCtr);
  const detectableShare = Math.sqrt((16 * leaderCtr * (1 - leaderCtr)) / sample) / leaderCtr;
  const progress = Math.min(1, (Math.max(0, gapShare) / detectableShare) ** 2);
  const needSample = progress > 0 ? Math.ceil(sample / progress) : null;
  return { gapShare, detectableShare, decisive: gapShare > detectableShare, sample, progress, needSample };
}

export function ctrLeaderVerdict(
  variants: { label: string; impressions: number; clicks: number }[],
  minViews = CTR_MIN_VIEWS,
): { leaderLabel: string; gapShare: number; detectableShare: number; decisive: boolean; sample: number; progress: number; needSample: number | null; text: string } | null {
  const scored = variants
    .filter((v) => v.impressions >= minViews)
    .map((v) => ({ ...v, ctr: v.clicks / v.impressions }))
    .sort((a, b) => b.ctr - a.ctr);
  if (scored.length < 2) return null;

  const [leader, runnerUp] = scored;
  if (leader.ctr <= 0) return null;

  // Порог для пары «лидер ↔ второе место» считает общая функция: правило
  // различимости живёт в одном месте, и экран не может разойтись с ним.
  const gap = ctrGapVerdict(leader, runnerUp);
  if (!gap) return null;
  const { gapShare, detectableShare, decisive, sample, progress, needSample } = gap;

  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const text = decisive
    ? `Лидер — «${leader.label}»: опережение ${pct(gapShare)} при ${sample.toLocaleString("ru-RU")} показах у слабейшего из двух. Такая разница уже надёжна, можно решать.`
    : `Впереди «${leader.label}», но опережение ${pct(gapShare)} меньше того, что различимо на ${sample.toLocaleString("ru-RU")} показах — это ${pct(detectableShare)}. Решать рано: продолжайте тест.`;

  return { leaderLabel: leader.label, gapShare, detectableShare, decisive, sample, progress, needSample, text };
}
