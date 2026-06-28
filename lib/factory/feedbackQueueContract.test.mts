import { ok, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFeedbackQueue, nextAnalysisForFeedback } from "./feedbackQueue";

const route = readFileSync("app/api/factory/feedback-queue/route.ts", "utf8");
const autoRoute = readFileSync("app/api/factory/feedback-queue/auto/route.ts", "utf8");

ok(!/function authOk/.test(route), "feedback queue relies on the global API proxy so Studio session and cron both work");
ok(/buildFeedbackQueue/.test(route), "feedback queue uses shared ranking helper");
ok(/action !== "winner" && action !== "reject"/.test(route), "feedback queue only accepts winner/reject actions");
ok(/viral_hooks/.test(route) && /viability_score: 5/.test(route), "winner feedback seeds learning hooks");
ok(/cf_signals/.test(route) && /event: "rejected"/.test(route), "reject feedback records anti-signal best-effort");
ok(/decideAutoFeedback/.test(autoRoute), "auto feedback endpoint uses deterministic decision helper");
ok(/body\.apply === true/.test(autoRoute), "auto feedback requires explicit apply=true before writes");
ok(/no objective winner signal found/.test(autoRoute), "auto feedback refuses to invent winners without objective signal");

const queue = buildFeedbackQueue([
  {
    id: 1,
    name: "low",
    url: "https://example.com/low.mp4",
    analysis: { memory_label: "usable", memory_score: 50, otk: 6 },
    created_at: "2026-06-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "strong",
    url: "https://example.com/strong.mp4",
    analysis: { memory_label: "usable", memory_score: 80, otk_score: 8 },
    created_at: "2026-06-02T00:00:00.000Z",
  },
  {
    id: 3,
    name: "trash",
    url: "https://example.com/trash.mp4",
    analysis: { memory_label: "trash", memory_score: 0, otk: 3 },
  },
], { limit: 10 });

equal(queue.length, 2, "trash is excluded by default");
equal(queue[0].asset_id, 2, "stronger candidate ranks first");
equal(queue[0].suggested_action, "review_for_winner", "usable high-score video is queued for winner review");

const rejected = nextAnalysisForFeedback({ memory_label: "usable" }, "reject", "bad hook");
equal(rejected.memory_label, "trash", "reject marks memory trash");
equal(rejected.operator_feedback, "reject", "reject source is recorded");

const winner = nextAnalysisForFeedback({}, "winner", "strong proof");
equal(winner.memory_label, "winner", "winner marks memory winner");
equal(winner.memory_score, 100, "winner gets max memory score");

const { decideAutoFeedback } = await import("./feedbackQueue");
equal(decideAutoFeedback({ id: 4, kind: "video", url: "https://e.com/a.mp4", analysis: { views: 3000 } }).action, "winner", "market views can auto-promote winner");
equal(decideAutoFeedback({ id: 5, kind: "video", url: "https://e.com/a.mp4", analysis: { otk: 4 } }).action, "trash", "low OTK auto-rejects trash");
equal(decideAutoFeedback({ id: 6, kind: "video", url: "https://e.com/a.mp4", analysis: { otk: 6 } }).action, "keep", "weak OTK is kept usable but not promoted");
equal(decideAutoFeedback({ id: 7, kind: "video", url: "https://e.com/a.mp4", analysis: { otk: 8, basis: "text" } }).action, "keep", "text-only OTK cannot auto-promote winner");
