import copy
import json
import tempfile
import unittest
from pathlib import Path

from tools.phase_2_a2_synthetic_mvp_security_review_validator import (
    EXPECTED_CONTENT_SHA,
    EXPECTED_REVIEWED_COMMIT,
    EXPECTED_REVIEWED_FILES,
    validate_evidence,
    Phase2A2ValidationError,
)


def load_evidence():
    path = Path("security/evidence/phase-2-a2/synthetic-mvp-security-review.json")
    return json.loads(path.read_text(encoding="utf-8"))


def write_temp_evidence(payload):
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False)
    with handle:
        json.dump(payload, handle)
    return Path(handle.name)


class Phase2A2SyntheticMvpSecurityReviewValidatorTests(unittest.TestCase):
    def test_evidence_validates_and_remains_not_production_ready(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["content_sha256"], EXPECTED_CONTENT_SHA)
        self.assertEqual(result["verdict"], "PHASE_2_SYNTHETIC_MVP_COMPLETE_NOT_PRODUCTION_READY")
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["real_credentials_approved"])
        self.assertFalse(result["network_calls_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_review_pins_a1_commit_and_exact_files(self):
        evidence = load_evidence()
        content = evidence["decision_content"]

        self.assertEqual(content["reviewed_commit"], EXPECTED_REVIEWED_COMMIT)
        self.assertEqual(
            [(item["path"], item["sha256"]) for item in content["reviewed_files"]],
            EXPECTED_REVIEWED_FILES,
        )

    def test_required_security_findings_are_true(self):
        findings = load_evidence()["decision_content"]["security_review_findings"]

        for field in (
            "a0_exact_owner_approval_verified",
            "changed_files_match_a0_allowlist",
            "fake_credentials_only",
            "fake_model_broker_only",
            "sanitized_environment_required",
            "mandatory_sensitive_environment_denylist_enforced",
            "terminal_surface_fake_or_fail_closed",
            "code_execution_surface_fake_or_fail_closed",
            "delegate_task_surface_fake_or_fail_closed",
            "mcp_surface_fake_or_fail_closed",
            "no_auth_json_or_keychain_reads",
            "no_runtime_execution",
        ):
            with self.subTest(field=field):
                self.assertTrue(findings[field])

    def test_runtime_network_and_credential_approvals_are_false(self):
        content = load_evidence()["decision_content"]

        for field in (
            "runtime_execution_approved",
            "production_profiles_approved",
            "gateway_changes_approved",
            "real_credentials_approved",
            "auth_file_reads_approved",
            "keychain_reads_approved",
            "oauth_refresh_approved",
            "provider_api_calls_approved",
            "model_api_calls_approved",
            "network_calls_approved",
            "subprocess_launch_approved",
            "sandbox_execution_approved",
            "deployment_approved",
        ):
            with self.subTest(field=field):
                self.assertFalse(content[field])

    def test_validator_denies_modified_verdict(self):
        tampered = copy.deepcopy(load_evidence())
        tampered["decision_content"]["verdict"] = "APPROVE_PRODUCTION"
        path = write_temp_evidence(tampered)

        with self.assertRaises(Phase2A2ValidationError) as context:
            validate_evidence(path)

        self.assertEqual(context.exception.reason, "CONTENT_SHA_MISMATCH")


if __name__ == "__main__":
    unittest.main()
