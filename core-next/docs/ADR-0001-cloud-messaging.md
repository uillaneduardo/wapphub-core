# ADR-0001 — WappHub Corporate Cloud Messaging

Status: **accepted for new implementation**, 2026-11-03. Scope: future WappHub Core Next, NOT legacy Core.
Frontend reference: https://github.com/uillaneduardo/wapphub-demo (published demo https://wapphub.ulln.com.br/).

## Boundaries
1. WappHub Demo: UI, interaction, cache, mock adapters. Business authorization and message durability are never client-owned.
2. Core Next: single source of truth for identity, organization/membership, channel, conversation, message, revision, receipt, sync events, and access control.
3. WappHub Internal: logical native channel implemented within the Core modular monolith, NOT an extra provider container.
4. External Providers (Baileys later): independent processes for external sessions, protocol translation, reconnection, ingestion and provider-origin events. Providers have no direct SQL write privilege to the Core DB.
5. API and worker may be separate processes of the same Core repository. Redis transports event notifications; Postgres outbox retains durable intent.

## Persistence and isolation
PostgreSQL is canonical. Each conversation belongs to one organization and channel, with memberships authorizing participants. The initial SQL supports text/direct channels; media/groups are future migrations. Individual message sequence assigned within a transaction by updating/locking conversation.last_sequence. Revisions are append-only: insert version 1 when sending, append n+1 on edit. For strong immutability, the service DB role must not have UPDATE/DELETE on revisions (or enforce with a trigger and separate role). Timestamp UTC; clients localize.

Use `clientMessageId` scoped by organization and sender for send deduplication. Repeated requests with identical payload return the original; identical key with different payload = 409. Editing requires expectedRevision and an atomic compare-and-swap. Access to revision history requires current authorization. All changes to messages and outbox must commit together. PostgreSQL row-level security is recommended as defense in depth, but NOT a substitute for explicit Core authorization.

## Synchronization
HTTP initial snapshot with opaque sync cursor, WebSocket incremental events, HTTP catch-up on reconnect. Cursor must be bound to organization and access scope, and expire with a clear `resync_required` protocol. Event IDs enable client dedup; per-conversation message sequence is distinct from sync cursor. Outbox delivery is at least once. Clients must tolerate duplicates and replay. `typing` and `presence` are ephemeral, not in outbox.

**Ordering warning**: a Postgres identity value is not necessarily commit order under concurrent transactions. A production cursor implementation MUST use a committed event log / safe publication watermark or commit-order protocol before exposing cursors. The `sync_position` in migration 0001 is schema preparation, **not** a deployable global replay guarantee.

## Security
Server-side sessions, Secure/HttpOnly cookies, session rotation, CSRF and Origin enforcement; direct membership and conversation permissions validated on each read/write and WebSocket subscribe. Credentials and provider sessions must never be embedded in the frontend. Corporate cloud encrypts data at rest and transit; it is **not** end-to-end encrypted. Provide audit log and retention controls before production.

## Data changes
`message.created`, `message.updated`, `message.deleted`, `message.status_changed`, `conversation.updated`, `conversation.read`, `member.permissions_changed`, `provider.state_changed` are durable events; `typing.started/stopped` and `presence.changed` are ephemeral. Schema versions, correlation IDs, tenant-aware authorization and explicit errors required.

## Operational gates
M0: ADR, baseline SQL, OpenAPI, domain contracts, tests, health only.
M1: session auth/CSRF, tenant RBAC, transactional send/edit/list, revision audit, duplicate handling.
M2: worker/outbox and committed-cursor replay, WS, read receipt, multi-device sync.
M3: integration of demo API adapter (explicit mode, no mock fallback), error/rollback UX.
M4: external provider integration, backup/restore, metrics, alerts, chaos tests.

This incubator is intentionally isolated under `incubator/wapphub-core-next/` because GitHub connector cannot create a repository. Extract the directory unchanged to a newly created independent repository before deploying. No existing Core code is imported, updated or retired.
