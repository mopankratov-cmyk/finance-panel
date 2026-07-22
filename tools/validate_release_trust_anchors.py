#!/usr/bin/env python3
"""Validate Phase 1B release trust-anchor registries without external calls."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.validate_installation_manifest import (
    DEFAULT_TRUST_ANCHORS_PATH,
    ManifestError,
    TRUST_ANCHOR_REGISTRY_RELATIVE_PATH,
    load_release_trust_anchor_registry,
    resolve_trusted_registry_path,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("registry")
    args = parser.parse_args(argv)
    try:
        requested = Path(args.registry)
        if not requested.is_absolute():
            if requested != TRUST_ANCHOR_REGISTRY_RELATIVE_PATH:
                raise ManifestError("TRUST_ANCHOR_REGISTRY_PATH_UNTRUSTED")
            requested = DEFAULT_TRUST_ANCHORS_PATH
        resolve_trusted_registry_path(requested)
        snapshot = load_release_trust_anchor_registry()
    except ManifestError as error:
        raise SystemExit(str(error)) from error
    print(
        "release trust-anchor registry validation OK "
        f"{snapshot.relative_path} "
        f"{snapshot.raw_sha256}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
