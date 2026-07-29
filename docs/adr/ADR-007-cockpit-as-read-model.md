# ADR-007: Cockpit as Read Model

- Status: Proposed

## Context

The live Cockpit proxies broad Hermes APIs, contains write actions, obtains a dashboard token, and opens direct WebSocket/PTY connections. It has no workflow database or event stream.

## Decision

Cockpit frontend will be a workflow read model and human-decision UI. A narrow authenticated Cockpit backend composes queries and submits domain commands to Workflow, Artifact, Review and Human Gate APIs. The browser will receive no provider/dashboard credential, perform no direct LLM call, and open no direct Hermes PTY/control channel.

## Alternatives

- Continue generic dashboard proxying.
- Make Cockpit own workflow transitions.
- Embed Hermes dashboard unchanged.

## Consequences

- Requires backend/BFF and event/read-model APIs.
- Some existing power-user controls move to a separate operator surface.
- Mock fallback data must be clearly development-only or removed from production views.

## Security implications

Browser compromise is limited to authenticated, authorized domain commands. Backend credentials remain server-side and commands are validated by the owning service.

## Open questions

- Which current dashboard controls remain in an operator-only console?
- Will director-cockpit be consolidated, integrated, or remain separate?
