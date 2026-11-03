# WappHub Core Next — M0 foundation

**New implementation, not legacy Core.** Self-contained Node.js >=22 + PostgreSQL. Currently only health endpoints work; OpenAPI contains planned protected routes that are NOT implemented.

## Why this is under the Core repository

The Core Next implementation resides in `core-next/`, isolated from the legacy source at repository root. The legacy main snapshot is preserved in branch `archive/core-legacy-2026-11-03`. Do not change old deployment paths; move the legacy tree to `legacy/` only with a verified full-tree relocation. No imports from demo or legacy code.

## Run locally

```bash
cd core-next
npm install
npm test
export POSTGRES_PASSWORD='choose-a-different-local-secret'
docker compose -f compose.dev.yml up -d --build
# Schema bootstrap is explicit:
# docker compose -f compose.dev.yml exec -T db psql -U wapphub -d wapphub < migrations/0001_initial.sql
curl http://127.0.0.1:3080/health/live
curl http://127.0.0.1:3080/health/ready
```

The database is private to Compose. The API is bound only to host loopback. Do not put the service on a public domain before implementing sessions, authorization and safe migration management.

## Included

- ADR-0001: boundaries, durability, reconciliation, cursor and security
- Migration 0001: tenants, users, memberships, channels, conversations, participants, messages, versions, receipts, outbox
- OpenAPI contract: messages, edit, revisions, sync, health
- Pure domain validators + security-isolation tests
- Health-only HTTP service (fail-closed for business operations)
- Docker/Compose development baseline and dedicated CI

## Explicitly NOT implemented

Authentication, message REST routes, migration runner, database transaction service, worker, WebSocket, complete event log with commit-ordered replay, encryption at rest deployment configuration, provider connectivity, alerting, backup. Do not mark these as shipped.

## Next milestones

M1: session identity + CSRF/Origin protections and per-conversation authorization; SQL transactional create/edit/list and unique idempotency check; migration tooling and integration tests.

M2: outbox worker with retry, WS, authorized and commit-safe event cursor replay, receipts and multi-device sync.

M3: switch demo from mock to explicit API adapter with no fallback.

All business endpoints MUST be denied until server authorization is in place.
