type SnapshotRow = Record<string, unknown>;
type SnapshotRowWithAudit = SnapshotRow & { audit: SnapshotRow | null };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown) {
  return Array.isArray(value) ? value as SnapshotRow[] : [];
}

function keyOf(niche: unknown, platform: unknown) {
  return `${text(niche)}__${text(platform)}`;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? value as SnapshotRow : null;
}

function scoreRow(row: SnapshotRowWithAudit) {
  return Number(Boolean(row.high_trust_generation_ready)) * 1000
    + Number(Boolean(row.publishable_exact)) * 300
    + Number(Boolean(row.upgrade_forecast)) * 100
    + Number(row.segment_priority_score || 0) * 10
    + Number(row.readiness_score || 0);
}

function upgradeForecastForRow(
  row: SnapshotRow,
  matrix?: {
    by_segment?: SnapshotRow[];
    by_platform?: SnapshotRow[];
    by_niche?: SnapshotRow[];
  } | null,
) {
  const bySegment = list(matrix?.by_segment);
  const exact = bySegment.find((item) => keyOf(item.niche, item.platform) === keyOf(row.niche, row.platform)) || null;
  const direct = asRecord(exact && typeof exact === "object" ? (exact as SnapshotRow).upgrade_forecast : null);
  if (direct) return direct;

  const byPlatform = list(matrix?.by_platform);
  const platformRow = byPlatform.find((item) => text(item.platform) === text(row.platform)) || null;
  const platformUpgrade = asRecord(platformRow && typeof platformRow === "object" ? (platformRow as SnapshotRow).next_upgrade : null);
  if (platformUpgrade) return platformUpgrade;

  const byNiche = list(matrix?.by_niche);
  const nicheRow = byNiche.find((item) => text(item.niche) === text(row.niche)) || null;
  return asRecord(nicheRow && typeof nicheRow === "object" ? (nicheRow as SnapshotRow).next_upgrade : null);
}

function matchesFilter(input: {
  row: SnapshotRow;
  lane?: string;
  niche?: string;
  platform?: string;
}) {
  const laneOk = !input.lane || text(input.row.lane) === input.lane;
  const nicheOk = !input.niche || text(input.row.niche) === input.niche;
  const platformOk = !input.platform || text(input.row.platform) === input.platform;
  return laneOk && nicheOk && platformOk;
}

export function buildReelsBrainDecisionSnapshot(input: {
  creativeExports?: {
    summary?: Record<string, unknown> | null;
    ship_now?: SnapshotRow[];
    validate_next?: SnapshotRow[];
    research_queue?: SnapshotRow[];
    items?: SnapshotRow[];
  } | null;
  readinessAudit?: {
    summary?: Record<string, unknown> | null;
    items?: SnapshotRow[];
  } | null;
  segmentSolutionMatrix?: {
    by_segment?: SnapshotRow[];
    by_platform?: SnapshotRow[];
    by_niche?: SnapshotRow[];
  } | null;
  lane?: string;
  niche?: string;
  platform?: string;
}) {
  const lane = text(input.lane);
  const niche = text(input.niche);
  const platform = text(input.platform);
  const exportItems = list(input.creativeExports?.items);
  const auditItems = list(input.readinessAudit?.items);
  const auditMap = new Map(auditItems.map((row) => [keyOf(row.niche, row.platform), row] as const));

  const items: SnapshotRowWithAudit[] = exportItems
    .filter((row) => matchesFilter({ row, lane, niche, platform }))
    .map((row) => ({
      ...row,
      audit: auditMap.get(keyOf(row.niche, row.platform)) || null,
      upgrade_forecast: upgradeForecastForRow(row, input.segmentSolutionMatrix || null),
    }));

  const attachAudit = (rows: SnapshotRow[]): SnapshotRowWithAudit[] =>
    rows
      .filter((row) => matchesFilter({ row, lane, niche, platform }))
      .map((row) => ({
        ...row,
        audit: auditMap.get(keyOf(row.niche, row.platform)) || null,
        upgrade_forecast: upgradeForecastForRow(row, input.segmentSolutionMatrix || null),
      }))
      .sort((a, b) => scoreRow(b) - scoreRow(a));

  return {
    lane: lane || null,
    niche: niche || null,
    platform: platform || null,
    summary: {
      exports: input.creativeExports?.summary || null,
      audit: input.readinessAudit?.summary || null,
      filtered_total: items.length,
      upgrade_forecast_segments: items.filter((row) => Boolean(row.upgrade_forecast)).length,
      generation_ready_segments: items.filter((row) => Boolean(row.high_trust_generation_ready)).length,
      publishable_exact_segments: items.filter((row) => Boolean(row.publishable_exact)).length,
    },
    ship_now: attachAudit(list(input.creativeExports?.ship_now)),
    validate_next: attachAudit(list(input.creativeExports?.validate_next)),
    research_queue: attachAudit(list(input.creativeExports?.research_queue)),
    items: [...items].sort((a, b) => scoreRow(b) - scoreRow(a)),
  };
}
