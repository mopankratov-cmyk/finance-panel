from _loader import load_test_functions
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.fixtures import synthetic_fixture
from pankster_security_harness.runtime_context import (
    ReusedContextExecutor,
    current_runtime_context,
    default_context,
    run_background_in_copied_context,
    run_batch_in_copied_context,
    run_in_copied_context,
    run_nested_in_copied_context,
    run_without_copied_context,
)
from pankster_security_harness.test_registry import record_baseline_result


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def _profile_id():
    context = current_runtime_context.get()
    return context.profile_id if context else None


def test_sec_bl_004_contextvar_loss_in_unwrapped_thread():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        token = current_runtime_context.set(context)
        try:
            direct = _profile_id()
            wrapped = run_in_copied_context(_profile_id)
            unwrapped = run_without_copied_context(_profile_id)
            result = record_baseline_result(BaselineResult(
                test_id="SEC-BL-004",
                classification="BASELINE_PARTIALLY_CONFIRMED",
                observed=True,
                observation="unwrapped thread loses synthetic profile context",
                evidence={"direct": direct, "wrapped": wrapped, "unwrapped": unwrapped},
                limitations="Python context fixture only",
            ))
        finally:
            current_runtime_context.reset(token)

    assert direct == "profile-a"
    assert wrapped == "profile-a"
    assert unwrapped is None
    assert result.classification == "BASELINE_PARTIALLY_CONFIRMED"


def test_sec_prot_007_008_009_010_context_propagation_wrappers():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        token = current_runtime_context.set(context)
        try:
            single = run_in_copied_context(_profile_id)
            batch = run_batch_in_copied_context([_profile_id, _profile_id, _profile_id])
            background = run_background_in_copied_context(_profile_id)
            nested = run_nested_in_copied_context(_profile_id)
        finally:
            current_runtime_context.reset(token)

    assert single == "profile-a"
    assert batch == ["profile-a", "profile-a", "profile-a"]
    assert background == "profile-a"
    assert nested == "profile-a"


def test_sec_prot_016_no_context_bleed_across_reused_thread_workers():
    with synthetic_fixture() as fixture:
        context_a = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        context_b = default_context(profile_home=fixture.profile_b_home, workspace_root=fixture.workspace_b, profile_id="profile-b")
        executor = ReusedContextExecutor()
        try:
            token_a = current_runtime_context.set(context_a)
            try:
                result_a = executor.submit_with_context(_profile_id).result(timeout=5)
                failing = executor.submit_with_context(lambda: (_ for _ in ()).throw(RuntimeError("synthetic failure")))
                try:
                    failing.result(timeout=5)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError("synthetic exception did not propagate")
            finally:
                current_runtime_context.reset(token_a)

            token_b = current_runtime_context.set(context_b)
            try:
                result_b = executor.submit_with_context(_profile_id).result(timeout=5)
            finally:
                current_runtime_context.reset(token_b)

            result_c = executor.submit_without_context(_profile_id).result(timeout=5)
            batch_results = []
            for context in (context_a, context_b):
                token = current_runtime_context.set(context)
                try:
                    batch_results.append(executor.submit_with_context(_profile_id).result(timeout=5))
                finally:
                    current_runtime_context.reset(token)
        finally:
            executor.shutdown()

    assert result_a == "profile-a"
    assert result_b == "profile-b"
    assert result_c is None
    assert batch_results == ["profile-a", "profile-b"]
