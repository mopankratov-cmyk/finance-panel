# Phase 1A Evidence

This directory is reserved for sanitized Phase 1A evidence artifacts.

Current Phase 1A evidence is produced by the synthetic tests at runtime and is
published through:

```text
current.json -> generations/<pack_id>/
```

`current.json` is the only authoritative pointer. Each generation contains the
four evidence JSON files plus `generation-manifest.json` with SHA-256 hashes.
Raw sentinel values must not be written here. Any future artifact added to this
directory must pass the sentinel redaction scan before it is committed.
