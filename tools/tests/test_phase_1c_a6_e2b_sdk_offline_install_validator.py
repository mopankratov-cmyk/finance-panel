import json
import unittest

from tools.phase_1c_a6_e2b_sdk_offline_install_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_VENV,
    EXPECTED_WHEELHOUSE,
    validate_contract,
)


class Phase1CA6E2BSDKOfflineInstallValidatorTests(unittest.TestCase):
    def test_a6_contract_validates_without_install_approval(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["owner_approval_command"], EXPECTED_APPROVAL_COMMAND)
        self.assertEqual(result["owner_approval_command_sha256"], EXPECTED_APPROVAL_COMMAND_SHA)
        self.assertFalse(result["dependency_install_approved"])
        self.assertTrue(result["offline_import_verification_allowed_after_approval"])
        self.assertFalse(result["provider_api_calls_allowed"])
        self.assertFalse(result["sandbox_creation_allowed"])
        self.assertFalse(result["pypi_allowed"])

    def test_a6_contract_is_offline_wheelhouse_only(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        scope = contract["contract_content"]["install_scope"]

        self.assertEqual(scope["mode"], "offline-wheelhouse-only")
        self.assertEqual(scope["wheelhouse_path"], EXPECTED_WHEELHOUSE)
        self.assertEqual(scope["venv_path"], EXPECTED_VENV)
        self.assertEqual(scope["pip_install_args_required"][0], "--no-index")
        self.assertIn("--find-links", scope["pip_install_args_required"])
        self.assertFalse(scope["network_allowed"])
        self.assertFalse(scope["pypi_allowed"])
        self.assertFalse(scope["global_site_packages_allowed"])
        self.assertFalse(scope["system_python_mutation_allowed"])

    def test_a6_contract_forbids_provider_calls_sandbox_and_credentials(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        forbidden = contract["contract_content"]["forbidden_actions"]

        self.assertTrue(forbidden["provider_api_calls"])
        self.assertTrue(forbidden["sandbox_creation"])
        self.assertTrue(forbidden["real_credentials"])
        self.assertTrue(forbidden["auth_file_reads"])
        self.assertTrue(forbidden["keychain_reads"])
        self.assertTrue(forbidden["environment_value_dump"])

    def test_a6_required_outputs_do_not_require_credential_presence_check(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        outputs = contract["contract_content"]["required_outputs"]

        self.assertTrue(outputs["venv_created_under_allowed_path"])
        self.assertTrue(outputs["pip_install_used_no_index"])
        self.assertTrue(outputs["pip_install_used_locked_wheelhouse"])
        self.assertTrue(outputs["offline_import_verification_passed"])
        self.assertFalse(outputs["provider_credential_presence_checked"])
        self.assertFalse(outputs["provider_credential_value_printed"])
        self.assertFalse(outputs["provider_api_calls_performed"])
        self.assertFalse(outputs["sandbox_created"])

    def test_a6_approval_command_is_exact(self):
        self.assertEqual(
            EXPECTED_APPROVAL_COMMAND,
            "APPROVE_PHASE_1C_E2B_SDK_OFFLINE_INSTALL:"
            "p1c-20260722-e2bsdkinstalla6:"
            "e1f79f661e639380d66a7148d973ee6983cf21f3b9c7d467c4fe9592ca724000",
        )
        self.assertEqual(
            EXPECTED_APPROVAL_COMMAND_SHA,
            "130ec9330cc0600b237f498789ed778dd75f51e64f479d35855fbffc967870ac",
        )


if __name__ == "__main__":
    unittest.main()
