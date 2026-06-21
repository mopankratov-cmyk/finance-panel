// Балансы платных сервисов завода — единый источник правды (реестр + сбор + история).
// Используется и роутом /api/factory/balances (GET/POST), и крон-тиком balances-tick.
// Всё best-effort: каждый внешний вызов / выборка БД в try → пусто/ошибка вместо краха.
import type { SupabaseClient } from "@supabase/supabase-js";
import { creatifyBalance } from "./creatify";
import { falBalance } from "./falVideo";
import { virloBalance } from "./trendSources";

export type BalanceCapability = "api" | "manual" | "estimated";
export type BalanceSource = "api" | "manual" | "estimated";

export interface ServiceMeta {
  service: string;          // ключ (virlo|creatify|fal|shotstack|anthropic)
  label: string;            // имя в UI
  unit: "USD" | "credits";  // единица баланса/порога
  capability: BalanceCapability; // как добываем баланс
  hint: string;             // подсказка под именем
}

// Реестр сервисов. Порядок = порядок карточек в дашборде.
export const SERVICE_REGISTRY: ServiceMeta[] = [
  { service: "virlo",     label: "Virlo",     unit: "USD",     capability: "api",       hint: "тренд-аналитика · get_credit_balance" },
  { service: "creatify",  label: "Creatify",  unit: "credits", capability: "api",       hint: "AI UGC-актёры · remaining_credits" },
  { service: "fal",       label: "FAL",       unit: "USD",     capability: "api",       hint: "видео-движки · нужен FAL_BILLING_KEY (admin)" },
  { service: "shotstack", label: "Shotstack", unit: "credits", capability: "manual",    hint: "сборка видео · нет API баланса → ручной ввод" },
  { service: "anthropic", label: "Claude",    unit: "USD",     capability: "estimated", hint: "мозг завода · нет API баланса → ручной + оценка" },
];

export interface BalancePoint { balance: number | null; at: string; source: BalanceSource }
export interface ServiceState {
  service: string;
  label: string;
  unit: "USD" | "credits";
  capability: BalanceCapability;
  balance: number | null;
  currency: string;
  source: BalanceSource;
  threshold: number | null;
  low: boolean;
  hint: string;
  updated_at: string | null;
  error?: string;
  note?: string;
  estimated_spend_30d?: number | null;
  history: BalancePoint[];
}

// 1 событие журнала ≈ одна Claude-операция завода. Грубая оценка — владелец крутит CLAUDE_EVENT_COST_USD.
const CLAUDE_EVENT_COST = Number(process.env.CLAUDE_EVENT_COST_USD) || 0.04;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Сетевые сбои к зарубежным API (гео/ISP-блок) → понятный текст вместо «TypeError: fetch failed».
// Частый кейс: локалка в РФ не пускает к virlo/fal (ECONNRESET), а Vercel (US) пускает.
function friendlyNetError(err?: string): string | undefined {
  if (!err) return err;
  if (/fetch failed|ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated|network/i.test(err)) {
    return "сеть не пускает к API (гео-блок?) — заработает на Vercel";
  }
  return err;
}

// Кэп на живой опрос: один залипший сервис не должен валить весь GET (Vercel рубит роут на maxDuration=30).
// virloBalance внутри держит 50с×2 — без кэпа дашборд завис бы. 9с × 5 сервисов параллельно = безопасно.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

async function liveApiBalance(service: string): Promise<{ balance: number | null; currency: string; raw?: unknown; error?: string }> {
  if (service === "virlo") return virloBalance();
  if (service === "creatify") return creatifyBalance();
  if (service === "fal") return falBalance();
  return { balance: null, currency: "", error: "нет live-баланса" };
}

interface Snapshot { balance: number | null; currency: string; source: BalanceSource; snapshot_at: string }

async function latestSnapshot(db: SupabaseClient, service: string): Promise<Snapshot | null> {
  try {
    const { data } = await db
      .from("service_balances")
      .select("balance,currency,source,snapshot_at")
      .eq("service", service)
      .order("snapshot_at", { ascending: false })
      .limit(1);
    const r = data && data[0];
    if (!r) return null;
    return { balance: num(r.balance), currency: r.currency || "", source: (r.source || "manual") as BalanceSource, snapshot_at: r.snapshot_at };
  } catch { return null; }
}

async function historyFor(db: SupabaseClient, service: string, n = 40): Promise<BalancePoint[]> {
  try {
    const { data } = await db
      .from("service_balances")
      .select("balance,source,snapshot_at")
      .eq("service", service)
      .order("snapshot_at", { ascending: false })
      .limit(n);
    return (data || [])
      .map((r: Record<string, unknown>) => ({ balance: num(r.balance), at: String(r.snapshot_at), source: (r.source || "manual") as BalanceSource }))
      .reverse();
  } catch { return []; }
}

export interface ThresholdRow { threshold: number | null; alerted_at: string | null; notes: string | null }
export async function loadThresholds(db: SupabaseClient): Promise<Record<string, ThresholdRow>> {
  const out: Record<string, ThresholdRow> = {};
  try {
    const { data } = await db.from("service_thresholds").select("service,threshold,alerted_at,notes");
    for (const r of (data || []) as Record<string, unknown>[]) {
      out[String(r.service)] = { threshold: num(r.threshold), alerted_at: (r.alerted_at as string) ?? null, notes: (r.notes as string) ?? null };
    }
  } catch { /* таблица не применена */ }
  return out;
}

async function estimateClaudeSpend30d(db: SupabaseClient): Promise<number | null> {
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count } = await db.from("cf_signals").select("id", { count: "exact", head: true }).gte("created_at", since);
    if (count == null) return null;
    return Math.round(count * CLAUDE_EVENT_COST * 100) / 100;
  } catch { return null; }
}

export interface CollectOpts { persist?: boolean; throttleMs?: number }

// Собрать состояние по всем сервисам. persist=true → пишет свежий api-снимок (не чаще throttleMs).
export async function collectBalances(db: SupabaseClient, opts: CollectOpts = {}): Promise<ServiceState[]> {
  const persist = opts.persist ?? false;
  const throttleMs = opts.throttleMs ?? 0;
  const thresholds = await loadThresholds(db);
  const claudeSpend = await estimateClaudeSpend30d(db);

  return Promise.all(SERVICE_REGISTRY.map(async (m): Promise<ServiceState> => {
    const threshold = thresholds[m.service]?.threshold ?? null;
    let balance: number | null = null;
    let currency: string = m.unit;
    let source: BalanceSource = m.capability === "api" ? "api" : m.capability;
    let error: string | undefined;
    let note: string | undefined;
    let updatedAt: string | null = null;
    let freshApiRaw: unknown;
    let wroteFresh = false;

    if (m.capability === "api") {
      const live = await withTimeout(liveApiBalance(m.service), 9000, { balance: null, currency: m.unit, error: "опрос завис >9с (сеть/гео) — заработает на Vercel" });
      if (live.balance != null) {
        balance = live.balance; currency = live.currency || currency; source = "api"; freshApiRaw = live.raw; updatedAt = new Date().toISOString(); wroteFresh = true;
      } else {
        error = friendlyNetError(live.error);
        const snap = await latestSnapshot(db, m.service); // фолбэк на последнее известное, чтобы не пусто
        if (snap) { balance = snap.balance; currency = snap.currency || currency; source = snap.source; updatedAt = snap.snapshot_at; }
      }
    } else {
      const snap = await latestSnapshot(db, m.service); // manual/estimated: владелец кладёт через POST
      if (snap) { balance = snap.balance; currency = snap.currency || currency; source = snap.source; updatedAt = snap.snapshot_at; }
      if (m.capability === "manual" && balance == null) note = "нет API баланса — задай вручную ниже";
      if (m.capability === "estimated") note = balance == null ? "нет API баланса — задай вручную; ниже оценка трат" : "ручной баланс; ниже оценка трат";
    }

    // запись снимка истории: только свежий api-баланс, с троттлингом (GET=30мин, крон=0)
    if (persist && wroteFresh && balance != null) {
      try {
        const last = await latestSnapshot(db, m.service);
        const ageOk = !last || (Date.now() - new Date(last.snapshot_at).getTime()) >= throttleMs;
        if (ageOk) await db.from("service_balances").insert({ service: m.service, balance, currency, source: "api", raw: freshApiRaw ?? null });
      } catch { /* снимок best-effort */ }
    }

    const history = await historyFor(db, m.service, 40);
    const low = balance != null && threshold != null && balance <= threshold;
    return {
      service: m.service, label: m.label, unit: m.unit, capability: m.capability,
      balance, currency, source, threshold, low, hint: m.hint, updated_at: updatedAt,
      error, note,
      estimated_spend_30d: m.service === "anthropic" ? claudeSpend : undefined,
      history,
    };
  }));
}
