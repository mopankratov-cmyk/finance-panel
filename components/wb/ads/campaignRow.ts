/**
 * Строка кампании в том виде, в каком её ждут разделы управления рекламой.
 *
 * Вынесено из экрана в отдельный файл, потому что источников у этой строки
 * теперь два: экран «Управление рекламой» строит её из своего запроса, а
 * объединённый модуль «Реклама» — из своего, более богатого. Разделы не должны
 * знать, кто их открыл, поэтому знают только этот минимум.
 */
export interface AdCampaign {
  id: number;
  name: string;
  status: number;
  bid_cpm_rub: number | null;
  bid_type?: string;
  spend_today: number;
  drr: number | null;
}

export interface CampaignRow {
  campaign: AdCampaign;
  nm: number;
  art: string;
}
