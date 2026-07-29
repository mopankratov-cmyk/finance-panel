"""Credential grant reference validation."""

from __future__ import annotations

import re

from .redaction import has_secret_shape
from .sentinels import contains_sentinel

MAX_GRANT_LENGTH = 96
ALLOWED_GRANT_TYPES = frozenset({"model", "mcp", "service"})
OPAQUE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
GRANT_RE = re.compile(r"^grant:(model|mcp|service):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$")


class GrantReferenceError(ValueError):
    pass


def validate_grant_reference(value: str) -> str:
    if not isinstance(value, str):
        raise GrantReferenceError("grant reference must be a string")
    if len(value) > MAX_GRANT_LENGTH:
        raise GrantReferenceError("grant reference is too long")
    if not value.isascii():
        raise GrantReferenceError("grant reference must be ASCII")
    if any(character.isspace() for character in value):
        raise GrantReferenceError("grant reference must not contain whitespace")
    if contains_sentinel(value) or has_secret_shape(value):
        raise GrantReferenceError("grant reference looks like secret material")

    match = GRANT_RE.fullmatch(value)
    if not match:
        raise GrantReferenceError("grant reference must match grant:<type>:<opaque-id>")
    grant_type, opaque_id = match.groups()
    if grant_type not in ALLOWED_GRANT_TYPES:
        raise GrantReferenceError("grant type is not allowed")
    if not OPAQUE_ID_RE.fullmatch(opaque_id):
        raise GrantReferenceError("opaque grant id is invalid")
    return value


def validate_grant_references(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(validate_grant_reference(value) for value in values)
