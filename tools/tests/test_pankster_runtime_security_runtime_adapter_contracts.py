import unittest

from tools.pankster_runtime_security.runtime_adapter_contracts import (
    BrokerForwardRequest,
    RuntimeAdapterConfig,
    RuntimeAdapterStub,
    RuntimeLaunchRequest,
    RuntimeSecurityContext,
)


def context(**overrides):
    values = {
        "profile_id": "synthetic-profile",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "policy_version": "policy-v1",
        "runtime_identity_hash": "runtime-hash",
        "network_policy_id": "deny-all",
        "grant_ids": ("grant_opaque_00000000000000000000000000000000",),
    }
    values.update(overrides)
    return RuntimeSecurityContext(**values)


class PanksterRuntimeSecurityRuntimeAdapterContractTests(unittest.TestCase):
    def test_default_adapter_denies_without_sanitizing_or_starting_runtime(self):
        adapter = RuntimeAdapterStub()

        decision = adapter.prepare_launch(
            RuntimeLaunchRequest(
                context=context(),
                source_environment={"PATH": "/usr/bin"},
                command=("python3", "-c", "pass"),
            )
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "RUNTIME_ADAPTER_DISABLED")
        self.assertEqual(decision.sanitized_environment.env, {})
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.broker_channel_started)

    def test_enabled_stub_sanitizes_explicit_environment_but_never_launches(self):
        adapter = RuntimeAdapterStub(RuntimeAdapterConfig(adapter_enabled=True, sandbox_launch_enabled=True))

        decision = adapter.prepare_launch(
            RuntimeLaunchRequest(
                context=context(),
                source_environment={
                    "PATH": "/usr/bin",
                    "NO_PROXY": "localhost",
                    "OPENAI_API_KEY": "synthetic-redacted",
                    "TELEGRAM_BOT_TOKEN": "synthetic-redacted",
                    "UNDECLARED": "ignored",
                },
                command=("python3", "-c", "pass"),
            )
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "SANDBOX_LAUNCH_NOT_IMPLEMENTED")
        self.assertEqual(decision.sanitized_environment.env["PATH"], "/usr/bin")
        self.assertEqual(decision.sanitized_environment.env["NO_PROXY"], "localhost")
        self.assertEqual(decision.sanitized_environment.env["PANKSTER_PROFILE_ID"], "synthetic-profile")
        self.assertEqual(decision.sanitized_environment.env["PANKSTER_GRANT_IDS"], "grant_opaque_00000000000000000000000000000000")
        self.assertIn("OPENAI_API_KEY", decision.sanitized_environment.denied_keys)
        self.assertIn("TELEGRAM_BOT_TOKEN", decision.sanitized_environment.denied_keys)
        self.assertIn("UNDECLARED", decision.sanitized_environment.ignored_keys)
        self.assertFalse(decision.sandbox_started)

    def test_missing_context_and_grants_fail_closed_before_environment_materialization(self):
        adapter = RuntimeAdapterStub(RuntimeAdapterConfig(adapter_enabled=True))

        missing_profile = adapter.prepare_launch(
            RuntimeLaunchRequest(
                context=context(profile_id=""),
                source_environment={"PATH": "/usr/bin"},
                command=("python3",),
            )
        )
        missing_grant = adapter.prepare_launch(
            RuntimeLaunchRequest(
                context=context(grant_ids=()),
                source_environment={"PATH": "/usr/bin"},
                command=("python3",),
            )
        )

        self.assertEqual(missing_profile.reason, "RUNTIME_CONTEXT_FIELD_MISSING:profile_id")
        self.assertEqual(missing_profile.sanitized_environment.env, {})
        self.assertEqual(missing_grant.reason, "RUNTIME_GRANT_MISSING")
        self.assertEqual(missing_grant.sanitized_environment.env, {})

    def test_missing_command_fails_closed_without_launch(self):
        adapter = RuntimeAdapterStub(RuntimeAdapterConfig(adapter_enabled=True))

        decision = adapter.prepare_launch(RuntimeLaunchRequest(context=context(), source_environment={"PATH": "/usr/bin"}))

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "RUNTIME_COMMAND_MISSING")
        self.assertEqual(decision.sanitized_environment.env, {})
        self.assertFalse(decision.sandbox_started)

    def test_broker_forward_stub_never_starts_channel_or_calls_provider(self):
        adapter = RuntimeAdapterStub(RuntimeAdapterConfig(adapter_enabled=True, broker_channel_enabled=True))

        decision = adapter.forward_to_broker(
            BrokerForwardRequest(
                context=context(),
                grant_id="grant_opaque_00000000000000000000000000000000",
                operation="model.complete",
                sequence_id="seq-1",
                payload_hash="abc123",
            )
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "BROKER_CHANNEL_NOT_IMPLEMENTED")
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.broker_channel_started)

    def test_broker_forward_requires_bound_grant_before_channel_stub(self):
        adapter = RuntimeAdapterStub(RuntimeAdapterConfig(adapter_enabled=True, broker_channel_enabled=True))

        decision = adapter.forward_to_broker(
            BrokerForwardRequest(
                context=context(),
                grant_id="grant_opaque_not_bound",
                operation="model.complete",
                sequence_id="seq-1",
                payload_hash="abc123",
            )
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "GRANT_NOT_BOUND_TO_CONTEXT")


if __name__ == "__main__":
    unittest.main()
