import json
from pathlib import Path

from _loader import load_test_functions
from pankster_security_harness.redaction import assert_no_secret_shape, assert_no_sentinel


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


EVIDENCE_DIR = Path(__file__).resolve().parents[1] / "evidence"
REQUIRED_EVIDENCE = {
    "baseline-results.json",
    "safe-prototype-results.json",
    "isolation-inventory.json",
    "test-run-summary.json",
}


def test_sec_prot_022_evidence_pack_contains_no_values():
    current_path = EVIDENCE_DIR / "current.json"
    assert current_path.exists(), "missing evidence current pointer"
    pointer = json.loads(current_path.read_text(encoding="utf-8"))
    assert pointer["schema_version"] == "phase1a.evidence.current.v1"
    generation_dir = EVIDENCE_DIR / "generations" / pointer["pack_id"]
    assert generation_dir.is_dir(), "current pointer does not resolve to a generation"
    manifest_path = generation_dir / "generation-manifest.json"
    assert manifest_path.exists(), "missing generation manifest"

    for filename in REQUIRED_EVIDENCE:
        path = generation_dir / filename
        assert path.exists(), f"missing evidence file: {filename}"
        data = json.loads(path.read_text(encoding="utf-8"))
        rendered = json.dumps(data, sort_keys=True)

        assert data["schema_version"] == "phase1a.evidence.v1"
        assert data["harness_version"] == "0.1.0"
        assert data["scope"] == "synthetic-only"
        assert data["timestamp"]
        assert data["test_ids"]
        assert "env_values" not in rendered
        assert "redacted_env_values" not in rendered
        assert "/Users/" not in rendered
        assert_no_sentinel(rendered)
        assert_no_secret_shape(rendered)
