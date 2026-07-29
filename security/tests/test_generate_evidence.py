import copy
import tempfile
import unittest
from pathlib import Path

from _loader import load_test_functions
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.test_registry import TEST_ID_REGISTRY
from tools.generate_evidence import (
    TestObservation,
    build_evidence,
    check_evidence,
    load_current_pointer,
    load_existing,
    run_test_suite,
    validate_recorded_host_inventory,
    write_evidence,
)


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def _passing_fixture():
    observations = {
        test_identity: TestObservation(
            test_identity=test_identity,
            test_name=test_identity.split(".")[-1],
            status="PASS",
        )
        for test_identity in TEST_ID_REGISTRY
    }
    baseline_records = {}
    for number in range(1, 7):
        test_id = f"SEC-BL-{number:03d}"
        baseline_records[test_id] = BaselineResult(
            test_id=test_id,
            classification="BASELINE_VULNERABILITY_CONFIRMED",
            observed=True,
            observation=f"synthetic observation for {test_id}",
            evidence={"observed": True},
            limitations="generator unit fixture",
        )
    return {
        "run": {
            "summary": {
                "passed": len(observations),
                "failed": 0,
                "errors": 0,
                "skipped": 0,
                "blocked": 0,
                "tests_run": len(observations),
            },
            "observations": observations,
            "successful": True,
        },
        "baseline_records": baseline_records,
    }


def _build(timestamp="2026-07-21T00:00:00Z"):
    fixture = _passing_fixture()
    return build_evidence(timestamp=timestamp, run=fixture["run"], baseline_records=fixture["baseline_records"])


def _function_case(module_name, function_name, callback):
    def wrapper():
        return callback()

    wrapper.__module__ = module_name
    wrapper.__name__ = function_name
    return unittest.FunctionTestCase(wrapper)


def test_sec_prot_031_evidence_summary_matches_actual_test_run_shape():
    evidence = _build()
    run_summary = evidence["test-run-summary.json"]

    assert run_summary["passed"] == len(TEST_ID_REGISTRY)
    assert run_summary["failed"] == 0
    assert run_summary["errors"] == 0
    assert run_summary["skipped"] == 0
    assert run_summary["tests_run"] == len(TEST_ID_REGISTRY)
    assert run_summary["timestamp"] == "2026-07-21T00:00:00Z"


def test_sec_prot_032_evidence_check_detects_stale_count():
    evidence = _build()
    stale = copy.deepcopy(evidence)
    stale["test-run-summary.json"]["passed"] = 1

    with tempfile.TemporaryDirectory(prefix="pankster-evidence-check-") as root:
        evidence_dir = Path(root)
        write_evidence(stale, evidence_dir, pack_id="stale-pack")
        try:
            check_evidence(evidence, evidence_dir, refresh_host_inventory=False)
        except SystemExit as error:
            assert "portable evidence is stale" in str(error)
        else:
            raise AssertionError("--check accepted stale evidence")

        write_evidence(evidence, evidence_dir, pack_id="good-pack")
        check_evidence(evidence, evidence_dir, refresh_host_inventory=False)
        loaded = load_existing(evidence_dir)
        assert loaded["test-run-summary.json"]["passed"] == len(TEST_ID_REGISTRY)


def test_sec_prot_037_generator_rejects_failing_suite():
    fixture = _passing_fixture()
    run = fixture["run"]
    first_identity = next(iter(run["observations"]))
    run["observations"][first_identity] = TestObservation(
        test_identity=first_identity,
        test_name=first_identity.split(".")[-1],
        status="FAIL",
        failure_category="AssertionError",
    )
    run["summary"]["passed"] -= 1
    run["summary"]["failed"] = 1
    run["successful"] = False

    try:
        build_evidence(timestamp="2026-07-21T00:00:00Z", run=run, baseline_records=fixture["baseline_records"])
    except RuntimeError:
        pass
    else:
        raise AssertionError("failing suite generated evidence")


def test_sec_prot_038_generator_does_not_overwrite_evidence_on_failure():
    good = _build()
    fixture = _passing_fixture()
    bad_run = fixture["run"]
    first_identity = next(iter(bad_run["observations"]))
    bad_run["observations"][first_identity] = TestObservation(
        first_identity,
        first_identity.split(".")[-1],
        "ERROR",
        "RuntimeError",
    )
    bad_run["summary"]["passed"] -= 1
    bad_run["summary"]["errors"] = 1
    bad_run["successful"] = False

    with tempfile.TemporaryDirectory(prefix="pankster-evidence-atomic-") as root:
        evidence_dir = Path(root)
        write_evidence(good, evidence_dir, pack_id="old-pack")
        before = (evidence_dir / "current.json").read_text(encoding="utf-8")
        try:
            build_evidence(timestamp="2026-07-21T00:00:00Z", run=bad_run, baseline_records=fixture["baseline_records"])
        except RuntimeError:
            pass
        else:
            raise AssertionError("failing run did not stop generation")
        after = (evidence_dir / "current.json").read_text(encoding="utf-8")
        assert after == before


def test_sec_prot_039_missing_required_test_id_fails_generation():
    fixture = _passing_fixture()
    run = fixture["run"]
    missing_identity = next(iter(TEST_ID_REGISTRY))
    del run["observations"][missing_identity]
    run["summary"]["passed"] -= 1
    run["summary"]["tests_run"] -= 1

    try:
        build_evidence(timestamp="2026-07-21T00:00:00Z", run=run, baseline_records=fixture["baseline_records"])
    except AssertionError as error:
        assert "did not execute" in str(error)
    else:
        raise AssertionError("missing required test id was accepted")


def test_sec_prot_040_duplicate_test_id_fails_generation():
    from pankster_security_harness.test_registry import validate_test_id_registry

    duplicate = dict(TEST_ID_REGISTRY)
    first, second = list(duplicate)[:2]
    duplicate[second] = duplicate[first]
    try:
        validate_test_id_registry(duplicate)
    except ValueError as error:
        assert "duplicate" in str(error)
    else:
        raise AssertionError("duplicate security test id was accepted")


def test_sec_prot_041_evidence_results_originate_from_actual_test_result():
    evidence = _build()
    safe_results = evidence["safe-prototype-results.json"]["results"]

    assert any(row["test_id"] == "SEC-PROT-023" and row["result"] == "PASS" for row in safe_results)
    assert all("test_identity" in row and "test_name" in row for row in safe_results)


def test_sec_prot_042_duplicate_short_names_do_not_collide():
    suite = unittest.TestSuite()
    suite.addTest(_function_case("module_a", "test_duplicate", lambda: (_ for _ in ()).throw(AssertionError("boom"))))
    suite.addTest(_function_case("module_b", "test_duplicate", lambda: None))

    run = run_test_suite(suite)

    assert set(run["observations"]) == {"module_a.test_duplicate", "module_b.test_duplicate"}
    assert run["observations"]["module_a.test_duplicate"].status == "FAIL"
    assert run["observations"]["module_b.test_duplicate"].status == "PASS"
    assert run["summary"]["failed"] == 1
    assert not run["successful"]


def test_sec_prot_043_unsuccessful_suite_rejected_even_with_failed_count_zero():
    fixture = _passing_fixture()
    fixture["run"]["successful"] = False

    try:
        build_evidence(
            timestamp="2026-07-21T00:00:00Z",
            run=fixture["run"],
            baseline_records=fixture["baseline_records"],
        )
    except RuntimeError as error:
        assert "unsuccessful" in str(error)
    else:
        raise AssertionError("unsuccessful suite was accepted")


def test_sec_prot_044_observation_count_must_equal_tests_run():
    fixture = _passing_fixture()
    first_identity = next(iter(fixture["run"]["observations"]))
    del fixture["run"]["observations"][first_identity]

    try:
        build_evidence(
            timestamp="2026-07-21T00:00:00Z",
            run=fixture["run"],
            baseline_records=fixture["baseline_records"],
        )
    except RuntimeError as error:
        assert "observation count" in str(error)
    else:
        raise AssertionError("observation count mismatch was accepted")


def test_sec_prot_045_failure_cannot_be_overwritten_by_later_pass():
    suite = unittest.TestSuite()
    suite.addTest(_function_case("module_a", "test_duplicate", lambda: (_ for _ in ()).throw(AssertionError("boom"))))
    suite.addTest(_function_case("module_b", "test_duplicate", lambda: None))

    run = run_test_suite(suite)

    assert run["observations"]["module_a.test_duplicate"].status == "FAIL"
    assert run["observations"]["module_b.test_duplicate"].status == "PASS"
    assert run["summary"]["passed"] == 1
    assert run["summary"]["failed"] == 1


def test_sec_prot_046_cross_host_check_does_not_report_stale_evidence():
    expected = _build()
    recorded = copy.deepcopy(expected)
    recorded["isolation-inventory.json"]["host_fingerprint"] = {
        "system": "SyntheticOS",
        "machine": "synthetic",
        "probe_version": "phase1a.isolation.v1",
    }

    with tempfile.TemporaryDirectory(prefix="pankster-cross-host-") as root:
        evidence_dir = Path(root)
        write_evidence(recorded, evidence_dir, pack_id="recorded-other-host")
        check_evidence(expected, evidence_dir, refresh_host_inventory=False)
        try:
            check_evidence(expected, evidence_dir, refresh_host_inventory=False, require_same_host=True)
        except SystemExit as error:
            assert "HOST_FINGERPRINT_MISMATCH" in str(error)
        else:
            raise AssertionError("strict same-host check accepted host mismatch")


def test_sec_prot_047_same_host_check_detects_changed_host_inventory():
    expected = _build()
    stale = copy.deepcopy(expected)
    stale["isolation-inventory.json"]["options"][0]["evidence"] = "synthetic changed evidence"

    with tempfile.TemporaryDirectory(prefix="pankster-same-host-") as root:
        evidence_dir = Path(root)
        write_evidence(stale, evidence_dir, pack_id="stale-host")
        try:
            check_evidence(expected, evidence_dir, refresh_host_inventory=False)
        except SystemExit as error:
            assert "host inventory is stale" in str(error)
        else:
            raise AssertionError("same-host stale inventory was accepted")


def test_sec_prot_048_recorded_host_inventory_decision_is_revalidated():
    evidence = _build()
    inventory = copy.deepcopy(evidence["isolation-inventory.json"])
    inventory["decision"] = {
        "recommended_backend": "docker",
        "production_isolation_gate": "BACKEND_SELECTED_FOR_PRODUCTION_PROTOTYPE",
        "decision": "invalid synthetic decision",
    }

    try:
        validate_recorded_host_inventory(inventory)
    except AssertionError as error:
        assert "decision" in str(error)
    else:
        raise AssertionError("invalid recorded host decision was accepted")


def test_sec_prot_049_failure_before_generation_rename_preserves_old_current():
    old = _build("2026-07-21T00:00:00Z")
    new = _build("2026-07-22T00:00:00Z")

    with tempfile.TemporaryDirectory(prefix="pankster-crash-before-") as root:
        evidence_dir = Path(root)
        write_evidence(old, evidence_dir, pack_id="old-pack")
        before = load_current_pointer(evidence_dir)
        try:
            write_evidence(new, evidence_dir, pack_id="new-pack", fail_at="before_generation_rename")
        except RuntimeError:
            pass
        else:
            raise AssertionError("injected failure did not fire")
        assert load_current_pointer(evidence_dir) == before
        assert not (evidence_dir / "generations" / "new-pack").exists()


def test_sec_prot_050_failure_after_generation_creation_but_before_pointer_swap_preserves_old_current():
    old = _build("2026-07-21T00:00:00Z")
    new = _build("2026-07-22T00:00:00Z")

    with tempfile.TemporaryDirectory(prefix="pankster-crash-after-gen-") as root:
        evidence_dir = Path(root)
        write_evidence(old, evidence_dir, pack_id="old-pack")
        before = load_current_pointer(evidence_dir)
        try:
            write_evidence(new, evidence_dir, pack_id="new-pack", fail_at="after_generation_creation")
        except RuntimeError:
            pass
        else:
            raise AssertionError("injected failure did not fire")
        assert load_current_pointer(evidence_dir) == before
        assert (evidence_dir / "generations" / "new-pack").is_dir()


def test_sec_prot_051_failure_during_pointer_creation_preserves_old_current():
    old = _build("2026-07-21T00:00:00Z")
    new = _build("2026-07-22T00:00:00Z")

    with tempfile.TemporaryDirectory(prefix="pankster-crash-pointer-") as root:
        evidence_dir = Path(root)
        write_evidence(old, evidence_dir, pack_id="old-pack")
        before = load_current_pointer(evidence_dir)
        try:
            write_evidence(new, evidence_dir, pack_id="new-pack", fail_at="during_pointer_creation")
        except RuntimeError:
            pass
        else:
            raise AssertionError("injected failure did not fire")
        assert load_current_pointer(evidence_dir) == before
        assert (evidence_dir / "generations" / "new-pack").is_dir()


def test_sec_prot_052_successful_pointer_swap_exposes_one_complete_generation():
    old = _build("2026-07-21T00:00:00Z")
    new = _build("2026-07-22T00:00:00Z")

    with tempfile.TemporaryDirectory(prefix="pankster-pointer-swap-") as root:
        evidence_dir = Path(root)
        write_evidence(old, evidence_dir, pack_id="old-pack")
        write_evidence(new, evidence_dir, pack_id="new-pack")
        pointer = load_current_pointer(evidence_dir)
        loaded = load_existing(evidence_dir)

        assert pointer["pack_id"] == "new-pack"
        assert loaded["test-run-summary.json"]["timestamp"] == "2026-07-22T00:00:00Z"
        assert sorted(path.name for path in (evidence_dir / "generations").iterdir()) == ["new-pack", "old-pack"]
