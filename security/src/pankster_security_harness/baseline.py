"""Structured baseline characterization results."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

BaselineClassification = Literal[
    "BASELINE_VULNERABILITY_CONFIRMED",
    "BASELINE_PARTIALLY_CONFIRMED",
    "BASELINE_NOT_REPRODUCED",
]

ALLOWED_BASELINE_CLASSIFICATIONS = frozenset(
    {
        "BASELINE_VULNERABILITY_CONFIRMED",
        "BASELINE_PARTIALLY_CONFIRMED",
        "BASELINE_NOT_REPRODUCED",
    }
)


@dataclass(frozen=True)
class BaselineResult:
    test_id: str
    classification: BaselineClassification
    observed: bool
    observation: str
    evidence: dict[str, object]
    limitations: str

    def __post_init__(self) -> None:
        if self.classification not in ALLOWED_BASELINE_CLASSIFICATIONS:
            raise ValueError("invalid baseline classification")
        if not self.test_id.startswith("SEC-BL-"):
            raise ValueError("baseline test_id must start with SEC-BL-")
        if self.classification == "BASELINE_VULNERABILITY_CONFIRMED" and self.observed is not True:
            raise ValueError("confirmed baseline result must be observed")
        if self.classification == "BASELINE_NOT_REPRODUCED" and self.observed is not False:
            raise ValueError("not reproduced baseline result must not be observed")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
