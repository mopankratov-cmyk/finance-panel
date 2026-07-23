import json
import unittest

from tools.phase_1c_a5_e2b_sdk_wheelhouse_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_PRIMARY_WHEEL_SHA,
    validate_contract,
)


class Phase1CA5E2BSDKWheelhouseValidatorTests(unittest.TestCase):
    def test_a5_contract_validates_without_download_approval(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["owner_approval_command"], EXPECTED_APPROVAL_COMMAND)
        self.assertEqual(result["owner_approval_command_sha256"], EXPECTED_APPROVAL_COMMAND_SHA)
        self.assertFalse(result["dependency_download_approved"])
        self.assertFalse(result["dependency_install_allowed"])
        self.assertFalse(result["dependency_import_allowed"])
        self.assertFalse(result["provider_api_calls_allowed"])
        self.assertFalse(result["sandbox_creation_allowed"])

    def test_a5_contract_pins_primary_e2b_wheel(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        package = content["python_package"]
        wheel = content["primary_artifacts"][0]

        self.assertEqual(package["name"], "e2b")
        self.assertEqual(package["version"], "2.34.0")
        self.assertEqual(wheel["filename"], "e2b-2.34.0-py3-none-any.whl")
        self.assertEqual(wheel["sha256"], EXPECTED_PRIMARY_WHEEL_SHA)
        self.assertFalse(wheel["yanked"])

    def test_a5_contract_forbids_install_import_provider_calls_and_sandbox_creation(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        forbidden = contract["contract_content"]["forbidden_actions"]

        self.assertTrue(forbidden["pip_install"])
        self.assertTrue(forbidden["dependency_import"])
        self.assertTrue(forbidden["provider_api_calls"])
        self.assertTrue(forbidden["sandbox_creation"])
        self.assertTrue(forbidden["real_credentials"])
        self.assertTrue(forbidden["gateway_changes"])

    def test_a5_download_scope_is_wheelhouse_only(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        scope = contract["contract_content"]["download_scope"]

        self.assertEqual(scope["allowed_hosts"], ["pypi.org", "files.pythonhosted.org"])
        self.assertTrue(scope["require_hash_manifest"])
        self.assertTrue(scope["require_only_binary"])
        self.assertFalse(scope["allow_sdists"])
        self.assertFalse(scope["allow_yanked"])
        self.assertFalse(scope["dependency_install_allowed"])
        self.assertFalse(scope["dependency_import_allowed"])

    def test_a5_required_outputs_include_transitive_hash_lock(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        outputs = contract["contract_content"]["required_outputs"]

        self.assertTrue(outputs["wheelhouse_manifest_json"])
        self.assertTrue(outputs["all_downloaded_files_sha256"])
        self.assertTrue(outputs["all_packages_pinned_exact_versions"])
        self.assertTrue(outputs["primary_wheel_sha_verified"])
        self.assertTrue(outputs["no_sdist_downloaded"])
        self.assertTrue(outputs["no_package_installed_or_imported"])


if __name__ == "__main__":
    unittest.main()
