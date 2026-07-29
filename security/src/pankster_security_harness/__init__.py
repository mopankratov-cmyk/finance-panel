"""Synthetic Phase 1A security harness.

This package is intentionally standalone. It must not import or mutate the live
Hermes runtime.
"""

__all__ = [
    "baseline",
    "env_policy",
    "fixtures",
    "grants",
    "isolation_probe",
    "redaction",
    "runtime_context",
    "spawn_prototype",
    "test_registry",
]
