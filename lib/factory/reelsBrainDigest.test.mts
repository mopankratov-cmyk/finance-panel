import assert from "node:assert/strict";
import test from "node:test";
import { loadReelsBrainPortfolioDigest } from "./reelsBrainDigest";

type Row = Record<string, unknown>;

class FakeQuery {
  private readonly rows: Row[];
  private filters: Array<{ column: string; value: unknown }> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  async limit(count: number) {
    let data = [...this.rows];
    for (const filter of this.filters) {
      data = data.filter((row) => row[filter.column] === filter.value);
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      data.sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return ascending
          ? String(left).localeCompare(String(right), undefined, { numeric: true })
          : String(right).localeCompare(String(left), undefined, { numeric: true });
      });
    }
    return { data: data.slice(0, count) };
  }
}

function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(name: string) {
      return new FakeQuery(tables[name] || []);
    },
  };
}

test("loadReelsBrainPortfolioDigest builds next actions and queue", async () => {
  const db = fakeDb({
    viral_videos: [
      { niche: "toys", platform: "tiktok", virality_score: 42, analyzed: true, hook_text: "Не покупай это", format_detected: "demo", sound_title: "summer", source_orbit_id: "apify_tiktok:toy" },
      { niche: "toys", platform: "instagram", virality_score: 24, analyzed: false, hook_text: "До и после", format_detected: "before_after", sound_title: "soft", source_orbit_id: "apify_instagram:toy" },
      { niche: "clothing", platform: "youtube", virality_score: 30, analyzed: true, hook_text: "3 ошибки", format_detected: "review", sound_title: "clean", source_orbit_id: "apify_youtube:cloth" },
    ],
    content_assets: [
      { niche: "toys", is_winner: true, winner_at: "2026-06-27T00:00:00.000Z", winner_learnings: { hook: "Не покупай это", target_platform: "tiktok" } },
    ],
    niche_playbooks: [
      {
        niche: "toys",
        updated_at: "2026-06-27T00:00:00.000Z",
        playbook: {
          reels_brain_patterns: {
            platform_brains: {
              tiktok: { patterns: [{ id: 1 }, { id: 2 }] },
              instagram: { patterns: [] },
              youtube: { patterns: [] },
            },
          },
          reels_brain_incidents: {
            history: [
              {
                id: "inc_1",
                platform: "tiktok",
                severity: "critical",
                kind: "empty_intake",
                message: "provider returned zero useful videos",
                created_at: "2026-06-27T00:00:00.000Z",
              },
            ],
          },
          reels_brain_queries: {
            stats: [
              {
                query: "toys viral",
                platform: "tiktok",
                runs: 3,
                found: 12,
                relevant: 7,
                inserted: 4,
                score: 30,
                updated_at: "2026-06-27T00:00:00.000Z",
              },
            ],
          },
          reels_brain_sources: {
            preferred_by_platform: {
              tiktok: {
                provider: "apify_tiktok",
                updated_at: "2026-06-27T00:00:00.000Z",
                source: "source-run",
              },
              instagram: {
                provider: "virlo",
                updated_at: "2026-06-27T01:00:00.000Z",
                source: "bake-off",
              },
            },
            history: [
              {
                platform: "instagram",
                provider: "virlo",
                updated_at: "2026-06-27T01:00:00.000Z",
                source: "bake-off",
              },
              {
                platform: "instagram",
                provider: "apify_instagram",
                updated_at: "2026-06-27T00:00:00.000Z",
                source: "source-run",
              },
            ],
          },
        },
      },
      {
        niche: "clothing",
        updated_at: "2026-06-27T00:00:00.000Z",
        playbook: {
          reels_brain_patterns: {
            platform_brains: {
              youtube: { patterns: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] },
            },
          },
          reels_brain_sources: {
            preferred_by_platform: {
              youtube: {
                provider: "apify_youtube",
                updated_at: "2026-06-27T00:00:00.000Z",
                source: "source-run",
              },
            },
          },
        },
      },
    ],
  });

  const digest = await loadReelsBrainPortfolioDigest(db, ["toys", "clothing"]);
  const toys = digest.niches.find((row) => row.niche === "toys");
  const clothing = digest.niches.find((row) => row.niche === "clothing");

  assert.equal(toys?.next_action, "inspect_incidents");
  assert.equal(toys?.next_action_priority, "p1");
  assert.equal(toys?.next_action_platform, "instagram");
  assert.match(String(toys?.next_action_query), /toy|toys/i);
  assert.match(String(toys?.next_action_reason), /critical incidents/i);
  assert.equal(toys?.platforms.find((row) => row.platform === "instagram")?.provider_shift?.active, true);
  assert.equal(toys?.platforms.find((row) => row.platform === "instagram")?.provider_shift?.from_provider, "apify_instagram");
  assert.equal(toys?.platforms.find((row) => row.platform === "instagram")?.provider_shift?.to_provider, "virlo");
  assert.equal(toys?.platforms.find((row) => row.platform === "instagram")?.retry_signal?.action, "retry_shifted_provider");

  assert.equal(clothing?.next_action, "weekly_retrain");
  assert.equal(digest.portfolio.total_niches, 2);
  assert.equal(digest.portfolio.action_queue[0]?.niche, "toys");
  assert.equal(digest.portfolio.action_queue[0]?.action, "inspect_incidents");
  assert.equal(digest.portfolio.action_queue[0]?.retry_signal?.action, "retry_shifted_provider");
  assert.equal(digest.portfolio.action_queue[0]?.provider_shift?.to_provider, "virlo");
  assert.equal(digest.portfolio.corpus_goal.total_target, 10000);
  assert.equal(digest.portfolio.corpus_goal.by_platform.find((row: { platform: string }) => row.platform === "tiktok")?.target, 4000);
  assert.equal(digest.niches.find((row) => row.niche === "toys")?.corpus_target, 5000);
});
