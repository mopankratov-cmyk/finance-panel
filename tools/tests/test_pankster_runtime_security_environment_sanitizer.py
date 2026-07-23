import unittest

from tools.pankster_runtime_security.environment_sanitizer import sanitize_environment


class PanksterRuntimeSecurityEnvironmentSanitizerTests(unittest.TestCase):
    def test_preserves_system_proxy_and_pankster_runtime_keys(self):
        result = sanitize_environment(
            {
                "PATH": "/usr/bin",
                "HOME": "/synthetic/home",
                "NO_PROXY": "localhost",
                "no_proxy": "127.0.0.1",
                "PANKSTER_PROFILE_ID": "synthetic",
                "PANKSTER_GRANT_IDS": "grant_opaque_fake",
            }
        )

        self.assertEqual(result.env["PATH"], "/usr/bin")
        self.assertEqual(result.env["NO_PROXY"], "localhost")
        self.assertEqual(result.env["no_proxy"], "127.0.0.1")
        self.assertEqual(result.env["PANKSTER_GRANT_IDS"], "grant_opaque_fake")
        self.assertEqual(result.denied_keys, ())

    def test_denylist_wins_over_allowlist_shape(self):
        result = sanitize_environment(
            {
                "OPENAI_API_KEY": "synthetic-redacted",
                "ANTHROPIC_TOKEN": "synthetic-redacted",
                "TELEGRAM_BOT_TOKEN": "synthetic-redacted",
                "E2B_API_KEY": "synthetic-redacted",
                "PATH_KEY": "synthetic-redacted",
            }
        )

        self.assertEqual(result.env, {})
        self.assertEqual(
            result.denied_keys,
            ("ANTHROPIC_TOKEN", "E2B_API_KEY", "OPENAI_API_KEY", "PATH_KEY", "TELEGRAM_BOT_TOKEN"),
        )

    def test_ignores_unknown_and_non_string_values_without_leaking_values(self):
        result = sanitize_environment({"CUSTOM_FLAG": "not-allowed", "PATH": 123})

        self.assertEqual(result.env, {})
        self.assertEqual(result.denied_keys, ())
        self.assertEqual(result.ignored_keys, ("CUSTOM_FLAG", "PATH"))
        self.assertNotIn("not-allowed", str(result))

    def test_case_insensitive_sensitive_key_denial(self):
        result = sanitize_environment({"openai_api_key": "synthetic-redacted", "authorization": "synthetic-redacted"})

        self.assertEqual(result.env, {})
        self.assertEqual(result.denied_keys, ("authorization", "openai_api_key"))

    def test_none_source_returns_empty_environment(self):
        result = sanitize_environment(None)

        self.assertEqual(result.env, {})
        self.assertEqual(result.denied_keys, ())
        self.assertEqual(result.ignored_keys, ())


if __name__ == "__main__":
    unittest.main()
