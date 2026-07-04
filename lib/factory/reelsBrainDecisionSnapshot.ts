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
    }));

  const attachAudit = (rows: SnapshotRow[]): SnapshotRowWithAudit[] =>
    rows
      .filter((row) => matchesFilter({ row, lane, niche, platform }))
      .map((row) => ({
        ...row,
        audit: auditMap.get(keyOf(row.niche, row.platform)) || null,
      }));

  return {
    lane: lane || null,
    niche: niche || null,
    platform: platform || null,
    summary: {
      exports: input.creativeExports?.summary || null,
      audit: input.readinessAudit?.summary || null,
      filtered_total: items.length,
    },
    ship_now: attachAudit(list(input.creativeExports?.ship_now)),
    validate_next: attachAudit(list(input.creativeExports?.validate_next)),
    research_queue: attachAudit(list(input.creativeExports?.research_queue)),
    items,
  };
}
