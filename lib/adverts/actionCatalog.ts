// Реестр действий модуля управления рекламой.
//
// Один список, из которого живут три вещи: подписи в интерфейсе, расшифровка
// строк журнала и решение, требует ли действие подтверждения. Раньше эти три
// знания разъехались бы по компонентам, и через месяц журнал показывал бы
// «bid» там, где кнопка называется «Ставка», а подтверждение стояло бы не у
// всех опасных операций, а у тех, о которых вспомнили.
//
// Порядок в файле — от безобидного к необратимому. Это не украшение: `risk`
// ниже читается интерфейсом, и любое новое действие обязано осознанно выбрать
// себе уровень, а не унаследовать чужой по соседству.

export type AdvertActionRisk =
  /** Меняет только показ данных у нас. Последствий в WB нет. */
  | "safe"
  /** Меняет поведение рекламы в WB, но обратимо одним движением. */
  | "reversible"
  /** Тратит деньги или создаёт сущности, которые сами не исчезнут. */
  | "money";

export interface AdvertActionSpec {
  /** Код действия. Он же уходит в журнал в поле `action` — менять нельзя. */
  id: string;
  label: string;
  /** Что произойдёт — текстом, который увидит человек перед подтверждением. */
  effect: string;
  risk: AdvertActionRisk;
  /** Метод WB, который дёргается. Пусто — действие живёт только у нас. */
  endpoint: string | null;
  /** Требует явного подтверждения в диалоге. */
  confirm: boolean;
}

export const ADVERT_ACTIONS: AdvertActionSpec[] = [
  {
    id: "start",
    label: "Запустить",
    effect: "Кампания начнёт показываться и тратить бюджет.",
    risk: "reversible",
    endpoint: "GET /adv/v0/start",
    confirm: false,
  },
  {
    id: "pause",
    label: "Пауза",
    effect: "Показы остановятся, бюджет и настройки сохранятся.",
    risk: "reversible",
    endpoint: "GET /adv/v0/pause",
    confirm: false,
  },
  {
    id: "stop",
    label: "Завершить",
    effect: "Кампания закрывается. Запустить её заново нельзя — только создать новую.",
    risk: "money",
    endpoint: "GET /adv/v0/stop",
    confirm: true,
  },
  {
    id: "rename",
    label: "Переименовать",
    effect: "Меняется только название кампании в кабинете WB.",
    risk: "safe",
    endpoint: "POST /adv/v0/rename",
    confirm: false,
  },
  {
    id: "bid",
    label: "Ставка",
    effect: "Меняет ставку по артикулу и месту показа. Влияет на расход сразу.",
    risk: "money",
    endpoint: "PATCH /api/advert/v1/bids",
    confirm: true,
  },
  {
    id: "cluster_bid",
    label: "Ставка по кластеру",
    effect: "Меняет ставку на конкретный поисковый кластер внутри кампании.",
    risk: "money",
    endpoint: "POST /adv/v0/normquery/bids",
    confirm: true,
  },
  {
    id: "cluster_bid_delete",
    label: "Снять ставку кластера",
    effect: "Кластер возвращается к общей ставке кампании.",
    risk: "reversible",
    endpoint: "DELETE /adv/v0/normquery/bids",
    confirm: false,
  },
  {
    id: "minus",
    label: "Минус-фразы",
    effect: "Заменяет весь набор минус-фраз артикула присланным списком.",
    risk: "reversible",
    endpoint: "POST /adv/v0/normquery/set-minus",
    confirm: true,
  },
  {
    id: "nms",
    label: "Состав карточек",
    effect: "Меняет набор артикулов, которые продвигает кампания.",
    risk: "reversible",
    endpoint: "PATCH /adv/v0/auction/nms",
    confirm: true,
  },
  {
    id: "create",
    label: "Создать кампанию",
    effect: "Заводит новую кампанию в кабинете WB. Удалить её из панели нельзя.",
    risk: "money",
    endpoint: "POST /adv/v2/seacat/save-ad",
    confirm: true,
  },
  {
    id: "deposit",
    label: "Пополнить бюджет",
    effect: "Списывает деньги со счёта, баланса или бонусов в бюджет кампании.",
    risk: "money",
    endpoint: "POST /adv/v1/budget/deposit",
    confirm: true,
  },
  {
    id: "rule_apply",
    label: "Автоправило",
    effect: "Правило само изменило ставку по расписанию.",
    risk: "money",
    endpoint: "PATCH /api/advert/v1/bids",
    confirm: false,
  },
];

const BY_ID = new Map(ADVERT_ACTIONS.map((action) => [action.id, action]));

export function advertAction(id: string): AdvertActionSpec | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Подпись действия для журнала.
 *
 * Журнал переживает переименования кнопок и появление новых действий, поэтому
 * неизвестный код не прячется и не падает — показывается как есть. Строка
 * «bid_v2» в истории честнее, чем пустая ячейка или выдуманная подпись.
 */
export function advertActionLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export const ADVERT_RISK_LABEL: Record<AdvertActionRisk, string> = {
  safe: "Безопасно",
  reversible: "Обратимо",
  money: "Влияет на деньги",
};
