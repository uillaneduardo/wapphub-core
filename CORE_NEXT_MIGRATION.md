# Core Next migration status

- Legacy protected snapshot: `archive/core-legacy-2026-11-03` (2026-11-03), sha `0d4356bc3d40b18def703b55a9c46309b6027ffb`
- New code: `core-next/` with isolated Node 22 service and SQL migration. It does not import legacy files.
- Old source **remains in root temporarily**. Migration into `legacy/core-v1/` is not yet completed.
- No legacy deployment workflows or containers have been migrated, disabled or restarted.
- New code is M0 ONLY. Health endpoints, schema and API contracts; business routes require session/RBAC and are fail-closed.
- Neither root nor `core-next/` should be deployed to production yet.
- CI: `.github/workflows/core-next-ci.yml`, path filtered, new tests only.

## Gates to complete relocation
Use an environment with full Git tree access to perform tracked-file relocation into `legacy/core-v1/` excluding the newly created `core-next` and its CI/migration manifests, verify path mapping with git diff --summary, and open a separate PR. Preserve original commit SHA and do not affect the deployed homelab stack.

## Next engineering milestone
Sessions + CSRF + authorization, PostgreSQL transactional message create/edit/history, tenant isolation, idempotency, and integration tests before realtime.
