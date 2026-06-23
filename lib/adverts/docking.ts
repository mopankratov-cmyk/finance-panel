// Чистое решение по докидыванию: конфиг + текущее состояние РК → что делать.
// Деньги тратятся ТОЛЬКО если enabled и решение deposit=true. Никаких сайд-эффектов здесь.

export interface DockConfig {
  advertId: number;
  enabled: boolean;
  hours: number[];       // окна МСК (0-23); пусто = каждый час
  amountRub: number;
  thresholdRub: number;
}
export interface DockState {
  budget: number | null; // текущий бюджет РК, ₽
  statusId: number | null; // статус WB (11 = пауза)
  currentHourMsk: number;
}
export interface DockDecision {
  deposit: boolean;
  relaunch: boolean;
  amount: number;
  reason: string;
}

export const WB_STATUS_PAUSED = 11;

export function decideDock(cfg: DockConfig, st: DockState, killSwitch = false): DockDecision {
  const none = (reason: string): DockDecision => ({ deposit: false, relaunch: false, amount: 0, reason });
  if (killSwitch) return none("kill-switch");
  if (!cfg.enabled) return none("выключено");
  if (cfg.hours.length && !cfg.hours.includes(st.currentHourMsk)) return none(`вне окна (${st.currentHourMsk}ч)`);
  if (cfg.amountRub < 50) return none("amount<50₽");

  const lowBudget = st.budget != null && st.budget < cfg.thresholdRub;
  const paused = st.statusId === WB_STATUS_PAUSED;
  if (!lowBudget && !paused) return none(`бюджет ок (${st.budget ?? "?"}₽)`);

  const parts: string[] = [];
  if (lowBudget) parts.push(`бюджет ${Math.round(st.budget as number)}<${cfg.thresholdRub} → +${cfg.amountRub}₽`);
  if (paused) parts.push("пауза → старт");
  return { deposit: lowBudget, relaunch: paused, amount: lowBudget ? cfg.amountRub : 0, reason: parts.join("; ") };
}
