"""Read-only isolation backend inventory."""

from __future__ import annotations

import platform
import shutil
from dataclasses import asdict, dataclass


CAPABILITY_VALUES = frozenset({"YES", "NO", "POSSIBLE", "UNVERIFIED", "NOT_APPLICABLE"})
RECOMMENDATION_VALUES = frozenset(
    {
        "RECOMMENDED",
        "VIABLE_FOR_SYNTHETIC_PROBE",
        "DISCOVERED_BUT_UNVALIDATED",
        "NOT_RECOMMENDED",
        "UNAVAILABLE",
        "UNVERIFIED",
    }
)


BACKEND_COMMANDS = (
    "container",
    "docker",
    "podman",
    "colima",
    "limactl",
    "lima",
    "nerdctl",
    "sandbox-exec",
    "systemd-run",
    "bwrap",
    "firejail",
)


@dataclass(frozen=True)
class IsolationOption:
    option: str
    installed: bool
    supported_on_host: bool
    filesystem_boundary: str
    credential_boundary: str
    network_policy: str
    identity_separation: str
    separate_identity_capability: str
    read_only_mounts: str
    operational_complexity: str
    security_strength: str
    evidence: str
    recommendation: str

    def __post_init__(self) -> None:
        for field_name in (
            "filesystem_boundary",
            "credential_boundary",
            "network_policy",
            "identity_separation",
            "separate_identity_capability",
            "read_only_mounts",
        ):
            if getattr(self, field_name) not in CAPABILITY_VALUES:
                raise ValueError(f"invalid capability enum for {field_name}")
        if self.recommendation not in RECOMMENDATION_VALUES:
            raise ValueError("invalid recommendation enum")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    def has_proven_production_boundary(self) -> bool:
        return all(
            getattr(self, field_name) == "YES"
            for field_name in (
                "filesystem_boundary",
                "credential_boundary",
                "network_policy",
                "identity_separation",
                "read_only_mounts",
            )
        )


def _host() -> str:
    return platform.system().lower()


def _installed(command: str) -> bool:
    return shutil.which(command) is not None


def inventory() -> list[IsolationOption]:
    host = _host()
    options: list[IsolationOption] = []
    for command in BACKEND_COMMANDS:
        installed = _installed(command)
        supported = (
            command in {"container", "docker", "podman", "colima", "limactl", "lima", "nerdctl", "sandbox-exec"}
            if host == "darwin"
            else command in {"docker", "podman", "nerdctl", "systemd-run", "bwrap", "firejail"}
        )
        if command == "sandbox-exec":
            options.append(
                IsolationOption(
                    option=command,
                    installed=installed,
                    supported_on_host=host == "darwin",
                    filesystem_boundary="UNVERIFIED",
                    credential_boundary="UNVERIFIED",
                    network_policy="UNVERIFIED",
                    identity_separation="NO",
                    separate_identity_capability="UNVERIFIED",
                    read_only_mounts="UNVERIFIED",
                    operational_complexity="medium",
                    security_strength="command presence only; not a production isolation proof",
                    evidence="command presence checked with shutil.which only; no sandbox profile executed",
                    recommendation="DISCOVERED_BUT_UNVALIDATED" if installed and host == "darwin" else "UNAVAILABLE",
                )
            )
            continue
        if command in {"docker", "podman", "nerdctl", "container"}:
            options.append(
                IsolationOption(
                    option=command,
                    installed=installed,
                    supported_on_host=supported,
                    filesystem_boundary="POSSIBLE",
                    credential_boundary="POSSIBLE",
                    network_policy="UNVERIFIED",
                    identity_separation="POSSIBLE",
                    separate_identity_capability="UNVERIFIED",
                    read_only_mounts="POSSIBLE",
                    operational_complexity="medium" if command == "container" else "medium-high",
                    security_strength="potentially strong if configured; not proven by command presence",
                    evidence="binary inventory only; no daemon or container started",
                    recommendation="DISCOVERED_BUT_UNVALIDATED" if installed and supported else "UNAVAILABLE",
                )
            )
            continue
        if command in {"colima", "limactl", "lima"}:
            options.append(
                IsolationOption(
                    option=command,
                    installed=installed,
                    supported_on_host=host == "darwin",
                    filesystem_boundary="POSSIBLE",
                    credential_boundary="POSSIBLE",
                    network_policy="UNVERIFIED",
                    identity_separation="POSSIBLE",
                    separate_identity_capability="UNVERIFIED",
                    read_only_mounts="POSSIBLE",
                    operational_complexity="high",
                    security_strength="potentially strong for filesystem identity; network not validated",
                    evidence="binary inventory only; VM not started",
                    recommendation="DISCOVERED_BUT_UNVALIDATED" if installed and host == "darwin" else "UNAVAILABLE",
                )
            )
            continue
        options.append(
            IsolationOption(
                option=command,
                installed=installed,
                supported_on_host=supported,
                filesystem_boundary="UNVERIFIED",
                credential_boundary="UNVERIFIED",
                network_policy="UNVERIFIED",
                identity_separation="UNVERIFIED",
                separate_identity_capability="UNVERIFIED",
                read_only_mounts="UNVERIFIED",
                operational_complexity="medium",
                security_strength="unverified",
                evidence="binary inventory only",
                recommendation="UNAVAILABLE" if not installed or not supported else "UNVERIFIED",
            )
        )
    return options


def feasibility_decision(options: list[IsolationOption]) -> dict[str, str]:
    recommended = next(
        (
            option
            for option in options
            if option.recommendation == "RECOMMENDED" and option.has_proven_production_boundary()
        ),
        None,
    )
    if recommended:
        return {
            "recommended_backend": recommended.option,
            "production_isolation_gate": "BACKEND_SELECTED_FOR_PRODUCTION_PROTOTYPE",
            "decision": "All required production boundary capabilities were proven.",
        }
    return {
        "recommended_backend": "none",
        "production_isolation_gate": "BLOCKED_ON_BACKEND_SELECTION",
        "decision": "No OS-level backend has proven filesystem, credential, network, identity and read-only mount boundaries.",
    }
