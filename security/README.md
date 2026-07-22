# PANKSTER Security Harness

Phase 1A synthetic security harness for PANKSTER Agent Platform.

This package is standalone and must not import or mutate live Hermes runtime code.
It uses only temporary directories, synthetic auth stores and fixed sentinel values.

## Run

```bash
cd security
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py'
```

The suite intentionally separates baseline characterization from safe prototype
tests. Baseline tests pass when they reproduce a synthetic unsafe behavior.

## Scope

- No real credentials are read.
- No live `~/.hermes` paths are used.
- No production profiles are started.
- No model/API calls are made.
- No isolation runtime is installed or started.
