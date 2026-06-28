import { equal, ok } from "node:assert/strict";
import { selectRenderCandidates } from "./candidateSelect";

{
  const result = selectRenderCandidates([
    { id: "weak", hook: "Привет, сегодня расскажу", concept: "generic ad", score: 9, verdict: "approved", batch_role: "experiment" },
    { id: "strong", hook: "90% выбирают тональный неправильно", concept: "show a half-face wear test", format: "до/после", score: 8, verdict: "approved", batch_role: "control" },
  ]);

  equal(result.paid_candidate_count, 1, "only one candidate goes to paid render by default");
  equal(result.selected[0]?.id, "strong", "generic hooks are excluded before render");
  ok(result.rejected.find((candidate) => candidate.id === "weak")?.reject_reasons.includes("generic_or_ad_hook"), "weak hook has explicit rejection reason");
  ok(result.rationale[0]?.includes("score 8/7"), "selected candidate records score rationale");
}

{
  const result = selectRenderCandidates([
    { id: "a", hook: "Проверь SPF после восьми часов на коже", concept: "wear test", score: 9, verdict: "approved" },
    { id: "b", hook: "Почему крем скатывается через час", concept: "problem proof", score: 8, verdict: "approved" },
    { id: "c", hook: "Как понять, что средство не для тебя", concept: "checklist", score: 7, verdict: "approved" },
  ], { top_k: 10, max_paid: 5 });

  equal(result.top_k, 2, "top_k is capped at the paid render safety limit");
  equal(result.paid_candidate_count, 2, "paid candidates never exceed two");
  equal(result.rejected.find((candidate) => candidate.id === "c")?.reject_reasons[0], "not_in_top_k", "non-selected approved candidates are explained");
}

{
  const result = selectRenderCandidates([
    { id: "control", hook: "Проверь этот шов до покупки", concept: "show seam proof", score: 8, verdict: "approved", batch_role: "control", change_axis: "none" },
    { id: "experiment", hook: "Почему дешевые аналоги выглядят хуже", concept: "comparison", score: 8, verdict: "approved", batch_role: "experiment", change_axis: "proof_density" },
  ]);

  equal(result.selected[0]?.id, "control", "control wins tie-breaks for stable batch learning");
  equal(result.selected[0]?.batch_role, "control", "selection preserves batch role");
  equal(result.selected[0]?.change_axis, "none", "selection preserves change axis");
}

{
  const result = selectRenderCandidates([
    { id: "bad", hook: "Купите сейчас", concept: "ad", score: 5, verdict: "rework" },
  ]);

  equal(result.ok, false, "selection can block paid render when every candidate is weak");
  equal(result.blocked_reason, "no_candidate_passed_pre_render_gate", "blocked result explains why render must not start");
}

console.log("candidateSelect: passed");
