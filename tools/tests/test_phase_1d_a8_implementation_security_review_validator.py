import json
import unittest

from tools.phase_1d_a8_implementation_security_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA8ImplementationSecurityReviewValidatorTests(unittest.TestCase):
    def test_a8_evidence_validates_security_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_SYNTHETIC_EXECUTION_APPROVAL_REQUEST_NOT_EXECUTION")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["execution_approved"])
        self.assertFalse(result["production_approved"])

    def test_a8_validated_chain_covers_a3_through_a7(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        chain = evidence["decision_content"]["validated_gate_chain"]

        self.assertEqual([item["gate"] for item in chain], ["1D-A3", "1D-A4", "1D-A5", "1D-A6", "1D-A7"])
        self.assertTrue(all(item["result"] == "PASS" for item in chain))

    def test_a8_security_findings_forbid_runtime_credentials_network_and_gateway(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertFalse(findings["runtime_security_modules_read_process_environment"])
        self.assertFalse(findings["runtime_security_modules_read_auth_json"])
        self.assertFalse(findings["runtime_security_modules_read_keychain"])
        self.assertFalse(findings["runtime_security_modules_use_network_clients"])
        self.assertFalse(findings["runtime_security_modules_launch_subprocesses"])
        self.assertFalse(findings["gateway_or_default_runtime_changes"])
        self.assertTrue(findings["secret_value_scan_passed"])

    def test_a8_records_full_suite_and_validator_chain_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]

        self.assertEqual(tests["phase_1d_validator_chain"]["result"], "PASS")
        self.assertEqual(tests["phase_1d_validator_chain"]["validators"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["result"], "PASS")
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 388)

    def test_a8_has_no_required_changes_and_next_gate_is_approval_request(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "1D-A9_SYNTHETIC_RUNNER_EXECUTION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
