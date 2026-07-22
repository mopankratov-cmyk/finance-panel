# ADR-008: Eval-Driven Self-Improvement

- Status: Proposed

## Context

Agent traces and outcomes can improve templates, skills and routing, but autonomous production mutation would create an unsafe feedback loop, especially around runtime and credential policy.

## Decision

A separate Eval/Learning System will consume sanitized traces and outcomes, propose versioned candidates, and evaluate them through sandbox tests, shadow mode, controlled canary, explicit promotion and rollback. It cannot directly change production security policy, credential scope, runtime isolation, human gates or protected executors.

## Alternatives

- Permit agents to edit their production prompts/policies directly.
- Use only manual improvement with no trace/eval system.
- Promote based on one successful canary.

## Consequences

- Adds dataset governance, scoring, experiment tracking and promotion workflow.
- Enables measurable improvement without silent production drift.
- Requires redaction and retention controls for traces.

## Security implications

Evaluation inputs may contain hostile or sensitive content and must run in isolated environments. Security invariants are immutable evaluation constraints, not optimization targets.

## Open questions

- Which outcome metrics and minimum sample sizes apply per workflow?
- What trace fields are necessary and privacy-safe?
