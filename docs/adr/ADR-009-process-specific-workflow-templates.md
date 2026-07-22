# ADR-009: Process-specific Workflow Templates

- Status: Proposed

## Context

Kanban SQLite является durable source of truth для задач,
запусков, событий и recovery metadata. Полноценного business
workflow source of truth сейчас нет.

Development, content, research, advertising and batch-production processes require different stages, evidence, review rules and Human Gates. Encoding one fixed business flow in Cockpit or in agent prompts would make process policy non-versioned and bypassable.

## Decision

The target Workflow Template Registry will store a separately versioned template per business process. Each template defines a sequence or DAG. Every stage in that sequence or DAG defines:

- its required worker role and reviewer role;
- required artifacts and acceptance criteria;
- maximum revision count and terminal behavior;
- dependencies on other stages.

The template also defines Human Gates appropriate to that process and risk tier.

The initial proposed template families are:

1. `development-feature`;
2. `bug-fix`;
3. `long-form-content`;
4. `ugc-video-ad`;
5. `pinterest-batch`;
6. `research-report`.

Cockpit will render a dynamic workflow read model from versioned events and template metadata. It must not hard-code business stages, transition authority or gate logic. Phase 0 defines this architecture only; it does not define or deploy a production YAML schema.

## Alternatives

- Use one universal workflow for every process.
- Encode process flow in prompts or skills.
- Hard-code each process in Cockpit.
- Allow agents to invent stages and gates at runtime.

## Consequences

- Process owners can evolve flows independently while retaining replay and auditability.
- Attempts are bound to an exact template version and cannot silently change mid-run.
- Template validation, migration and compatibility testing become required.
- Cockpit needs generic DAG/stage/gate presentation components.

## Security implications

Template content cannot grant tools, credentials or runtime access beyond independently versioned security policy. Protected transitions still require valid reviewer and Human Gate decisions. Unknown templates, invalid versions, dependency cycles and exhausted revision limits fail closed.

## Open questions

- Which schema language and registry backend will be selected in Phase 1?
- Which stages and Human Gates belong in the first version of each template?
- How are compatible and breaking template migrations classified?
