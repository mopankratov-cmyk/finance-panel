import json
import unittest

from tools.phase_1d_a6_runtime_adapter_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA6RuntimeAdapterValidatorTests(unittest.TestCase):
    def test_a6_evidence_validates_implemented_runtime_adapter_contracts(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertIn("tools/pankster_runtime_security/runtime_adapter_contracts.py", result["implemented_files"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A7_SYNTHETIC_RUNNER_PREFLIGHT_CONTRACT")

    def test_a6_contract_defaults_disabled_and_runtime_unimplemented(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["runtime_adapter_contract"]

        self.assertFalse(contract["default_adapter_enabled"])
        self.assertFalse(contract["default_broker_channel_enabled"])
        self.assertFalse(contract["default_sandbox_launch_enabled"])
        self.assertFalse(contract["sandbox_launch_implemented"])
        self.assertFalse(contract["broker_channel_implemented"])
        self.assertFalse(contract["subprocess_execution"])
        self.assertTrue(contract["explicit_environment_input_only"])

    def test_a6_purity_contract_blocks_side_effects(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        purity = evidence["decision_content"]["purity_contract"]

        for value in purity.values():
            self.assertFalse(value)
        self.assertIn("reads_process_environment", purity)
        self.assertIn("reads_auth_json", purity)
        self.assertIn("network_calls", purity)
        self.assertIn("subprocess_launch", purity)

    def test_a6_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]["targeted_runtime_adapter_contract_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 6)

    def test_a6_fail_closed_reasons_cover_launch_and_broker_paths(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        reasons = evidence["decision_content"]["fail_closed_reasons"]

        for reason in ("RUNTIME_ADAPTER_DISABLED", "SANDBOX_LAUNCH_NOT_IMPLEMENTED", "BROKER_CHANNEL_DISABLED", "BROKER_CHANNEL_NOT_IMPLEMENTED"):
            self.assertIn(reason, reasons)


if __name__ == "__main__":
    unittest.main()
