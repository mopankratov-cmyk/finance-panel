import subprocess
import sys

from _loader import load_test_functions
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.fixtures import baseline_select_provider, synthetic_fixture
from pankster_security_harness.sentinels import ROOT_SENTINEL
from pankster_security_harness.test_registry import record_baseline_result


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_bl_002_same_uid_can_read_synthetic_root_auth():
    with synthetic_fixture() as fixture:
        code = (
            "import pathlib, sys; "
            "path = pathlib.Path(sys.argv[1]); "
            "print('READ_OK' if path.read_text(encoding='utf-8') else 'EMPTY')"
        )
        completed = subprocess.run(
            [sys.executable, "-c", code, str(fixture.root_auth)],
            cwd=str(fixture.workspace_a),
            env={
                "PATH": "/usr/bin:/bin",
                "HOME": str(fixture.profile_a_home),
                "HERMES_HOME": str(fixture.profile_a_home),
            },
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        result = record_baseline_result(BaselineResult(
            test_id="SEC-BL-002",
            classification="BASELINE_VULNERABILITY_CONFIRMED",
            observed=True,
            observation="same-UID fixture subprocess read synthetic root auth path",
            evidence={"exit_code": completed.returncode, "stdout": completed.stdout.strip()},
            limitations="synthetic temp paths only",
        ))

    assert result.classification == "BASELINE_VULNERABILITY_CONFIRMED"
    assert result.evidence["stdout"] == "READ_OK"


def test_sec_bl_003_root_credential_fallback_selects_root_provider():
    with synthetic_fixture() as fixture:
        selected = baseline_select_provider(fixture.profile_a_auth, fixture.root_auth, "anthropic")
        result = record_baseline_result(BaselineResult(
            test_id="SEC-BL-003",
            classification="BASELINE_VULNERABILITY_CONFIRMED",
            observed=True,
            observation="synthetic root provider selected when profile provider is absent",
            evidence={"selected_root_provider": selected == ROOT_SENTINEL},
            limitations="no OAuth or provider call",
        ))

    assert selected == ROOT_SENTINEL
    assert result.evidence["selected_root_provider"] is True
