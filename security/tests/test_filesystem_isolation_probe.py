from _loader import load_test_functions
from pankster_security_harness.isolation_probe import (
    BACKEND_COMMANDS,
    CAPABILITY_VALUES,
    RECOMMENDATION_VALUES,
    feasibility_decision,
    inventory,
)


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_iso_001_backend_inventory_lists_required_options():
    options = inventory()
    names = {option.option for option in options}

    assert set(BACKEND_COMMANDS) <= names
    assert all(option.recommendation in RECOMMENDATION_VALUES for option in options)
    assert all(option.filesystem_boundary in CAPABILITY_VALUES for option in options)


def test_sec_iso_002_filesystem_boundary_capability_is_not_claimed_from_presence_only():
    options = inventory()

    assert all(option.has_proven_production_boundary() for option in options if option.recommendation == "RECOMMENDED")
    assert all(option.recommendation != "RECOMMENDED" for option in options if not option.has_proven_production_boundary())


def test_sec_iso_003_network_boundary_requires_explicit_policy():
    options = inventory()

    for option in options:
        assert option.network_policy in CAPABILITY_VALUES
        if option.recommendation == "RECOMMENDED":
            assert option.network_policy == "YES"


def test_sec_iso_004_separate_identity_capability_is_reported():
    options = inventory()
    decision = feasibility_decision(options)

    assert "recommended_backend" in decision
    assert decision["production_isolation_gate"] == "BLOCKED_ON_BACKEND_SELECTION"
    assert all(option.separate_identity_capability in CAPABILITY_VALUES for option in options)
    assert all(option.separate_identity_capability == "UNVERIFIED" for option in options)
