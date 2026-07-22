from _loader import load_test_functions
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.env_policy import baseline_no_proxy_allowlists
from pankster_security_harness.test_registry import record_baseline_result


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_bl_006_no_proxy_allowlists_are_inconsistent():
    allowlists = baseline_no_proxy_allowlists()

    assert "NO_PROXY" in allowlists["terminal"]
    assert "no_proxy" not in allowlists["terminal"]
    assert "no_proxy" in allowlists["code_execution"]
    assert "NO_PROXY" not in allowlists["code_execution"]
    assert allowlists["terminal"] != allowlists["code_execution"]
    result = record_baseline_result(BaselineResult(
        test_id="SEC-BL-006",
        classification="BASELINE_VULNERABILITY_CONFIRMED",
        observed=True,
        observation="modeled allowlists preserve inconsistent NO_PROXY variants",
        evidence={"terminal": sorted(allowlists["terminal"]), "code_execution": sorted(allowlists["code_execution"])},
        limitations="modeled allowlists only",
    ))
    assert result.classification == "BASELINE_VULNERABILITY_CONFIRMED"
