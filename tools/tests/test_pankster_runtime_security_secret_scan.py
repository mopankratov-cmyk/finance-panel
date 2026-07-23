import unittest

from tools.pankster_runtime_security.secret_scan import is_secret_field_name, scan_secret_shapes


class PanksterRuntimeSecuritySecretScanTests(unittest.TestCase):
    def test_secret_scan_allows_reference_only_payload(self):
        result = scan_secret_shapes(
            {
                "credential_ref_id": "cred_ref_openai_primary",
                "grant_id": "grant_ref_abc",
                "metadata": {"provider_family": "openai"},
            }
        )

        self.assertTrue(result.allowed)
        self.assertEqual(result.findings, ())

    def test_secret_scan_reports_sensitive_field_names_without_values(self):
        result = scan_secret_shapes({"api_key": "redacted-fixture", "nested": {"authorization_header": "redacted-fixture"}})

        self.assertFalse(result.allowed)
        self.assertEqual([finding.path for finding in result.findings], ["$.api_key", "$.nested.authorization_header"])
        self.assertNotIn("redacted-fixture", str(result.findings))

    def test_secret_scan_reports_secret_shaped_values_without_values(self):
        result = scan_secret_shapes({"note": "Bearer abcdefghijklmnopqrstuvwxyz123456"})

        self.assertFalse(result.allowed)
        self.assertEqual(result.findings[0].path, "$.note")
        self.assertEqual(result.findings[0].reason, "BEARER_AUTHORIZATION_SHAPE")
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", str(result.findings))

    def test_secret_field_name_matches_provider_patterns(self):
        self.assertTrue(is_secret_field_name("OPENAI_API_KEY"))
        self.assertTrue(is_secret_field_name("telegram_bot_token"))
        self.assertTrue(is_secret_field_name("SUPABASE_SERVICE_SECRET"))
        self.assertFalse(is_secret_field_name("credential_ref_id"))

    def test_secret_scan_descends_lists(self):
        result = scan_secret_shapes([{"credential_ref_id": "safe"}, {"refresh_token": "redacted-fixture"}])

        self.assertFalse(result.allowed)
        self.assertEqual(result.findings[0].path, "$[1].refresh_token")


if __name__ == "__main__":
    unittest.main()
