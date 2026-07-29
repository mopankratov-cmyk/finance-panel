from _loader import load_test_functions
from pankster_security_harness.evidence import EvidenceEvent, argv_snapshot
from pankster_security_harness.evidence import write_sanitized_evidence
from pankster_security_harness.redaction import assert_no_secret_shape, assert_no_sentinel, has_secret_shape, redact_text, sanitized_json
from pankster_security_harness.sentinels import GATEWAY_SENTINEL, REDACTED_SENTINEL


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_prot_011_log_and_evidence_redaction_removes_sentinel():
    event = EvidenceEvent(
        "synthetic_error",
        {
            "stdout": f"value={GATEWAY_SENTINEL}",
            "stderr": f"error {GATEWAY_SENTINEL}",
            "exception": RuntimeError(f"boom {GATEWAY_SENTINEL}"),
        },
    )
    rendered = event.to_json()

    assert REDACTED_SENTINEL in rendered
    assert_no_sentinel(rendered)


def test_sec_prot_012_no_secret_in_argv_snapshot():
    snapshot = argv_snapshot(["python", "-c", f"print('{GATEWAY_SENTINEL}')"])
    rendered = sanitized_json(snapshot)

    assert REDACTED_SENTINEL in rendered
    assert_no_sentinel(rendered)


def test_redaction_assertion_fails_if_raw_sentinel_remains():
    try:
        assert_no_sentinel(f"raw {GATEWAY_SENTINEL}")
    except AssertionError:
        pass
    else:
        raise AssertionError("raw sentinel was not rejected")


def test_redact_text_replaces_all_known_sentinel_values():
    assert redact_text(GATEWAY_SENTINEL) == REDACTED_SENTINEL


def test_sec_prot_033_raw_nested_sentinel_assertion():
    try:
        assert_no_sentinel({"nested": GATEWAY_SENTINEL})
    except AssertionError:
        pass
    else:
        raise AssertionError("raw nested sentinel was not rejected")


def test_sec_prot_034_evidence_event_sanitizes_event_type():
    event = EvidenceEvent(GATEWAY_SENTINEL, {}).sanitized()

    assert event["event_type"] == REDACTED_SENTINEL
    assert_no_sentinel(event)


def test_sec_prot_035_evidence_event_nested_sentinel_redaction():
    event = EvidenceEvent("nested", {"outer": [{"inner": GATEWAY_SENTINEL}]}).sanitized()

    assert event["payload"]["outer"][0]["inner"] == REDACTED_SENTINEL
    assert_no_sentinel(event)


def test_sec_prot_036_generic_secret_in_event_type_fails_closed():
    try:
        EvidenceEvent("sk-abcdefghijk", {}).sanitized()
    except AssertionError:
        pass
    else:
        raise AssertionError("generic secret shape in event_type was accepted")


def test_sec_prot_021_generic_evidence_detector():
    bad_values = (
        "sk-live-example",
        "Bearer abc",
        "https://user:password@example.test",
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        "password=hunter2",
    )
    for value in bad_values:
        assert has_secret_shape(value)
        try:
            assert_no_secret_shape(value)
        except AssertionError:
            pass
        else:
            raise AssertionError(f"secret-shaped evidence accepted: {value}")


def test_sec_prot_024_evidence_event_rejects_generic_secret_shape():
    bad_values = (
        "sk-abcdefghijk",
        "Bearer abcdef",
        "password=hunter2",
        "https://user:password@example.test",
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    )
    for value in bad_values:
        event = EvidenceEvent("bad", {"outer": {"list": [{"value": value}]}})
        try:
            event.sanitized()
        except AssertionError:
            pass
        else:
            raise AssertionError(f"secret-shaped evidence accepted: {value}")


def test_sec_prot_025_argv_snapshot_rejects_generic_secret_shape():
    for value in ("sk-abcdefghijk", "Bearer abcdef", "https://user:password@example.test"):
        try:
            argv_snapshot(["python", "-c", value])
        except AssertionError:
            pass
        else:
            raise AssertionError(f"secret-shaped argv accepted: {value}")


def test_sec_prot_026_evidence_writer_rejects_generic_secret_shape():
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory(prefix="pankster-evidence-writer-") as root:
        path = Path(root) / "evidence.json"
        event = EvidenceEvent("bad", {"value": "api_key=value123"})
        try:
            write_sanitized_evidence(path, event)
        except AssertionError:
            pass
        else:
            raise AssertionError("secret-shaped evidence was written")
        assert not path.exists()
