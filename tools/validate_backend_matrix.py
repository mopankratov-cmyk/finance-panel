#!/usr/bin/env python3
"""Validate Phase 1B-A backend matrix arithmetic."""

from __future__ import annotations

import json
import sys
from pathlib import Path

EXPECTED_SCHEMA = "phase1b-a.backend-matrix.v1"
TOLERANCE = 0.000001


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    matrix_path = Path(argv[0]) if argv else Path("docs/security/isolation_backend_matrix.json")
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    if matrix.get("schema_version") != EXPECTED_SCHEMA:
        raise SystemExit(f"invalid schema_version: {matrix.get('schema_version')}")
    weights = matrix["weights"]
    weight_total = sum(weights.values())
    if abs(weight_total - 1.0) > TOLERANCE:
        raise SystemExit(f"weights must sum to 1.0, got {weight_total}")
    for backend in matrix["backends"]:
        scores = backend["scores"]
        missing = sorted(set(weights) - set(scores))
        extra = sorted(set(scores) - set(weights))
        if missing or extra:
            raise SystemExit(f"{backend['name']}: score keys mismatch missing={missing} extra={extra}")
        for key, score in scores.items():
            if not isinstance(score, int) or score < 0 or score > 5:
                raise SystemExit(f"{backend['name']}: invalid score {key}={score}")
        computed = round(sum(scores[key] * weights[key] for key in weights), 2)
        declared = backend["weighted_score"]
        if abs(computed - declared) > TOLERANCE:
            raise SystemExit(f"{backend['name']}: weighted score mismatch declared={declared} computed={computed}")
        if not backend.get("eligibility_constraints"):
            raise SystemExit(f"{backend['name']}: missing eligibility_constraints")
    print(f"backend matrix OK: {len(matrix['backends'])} backends")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
