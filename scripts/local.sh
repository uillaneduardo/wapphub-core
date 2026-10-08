#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-status}" in
  up|deploy)
    docker compose build wapphub-core-api
    docker compose up -d --wait wapphub-db wapphub-redis
    docker compose run --rm --no-deps wapphub-core-api npm run db:migrate
    docker compose up -d --wait
    ;;
  stop) docker compose stop ;;
  logs) docker compose logs --tail 100 "${2:-wapphub-core-api}" ;;
  status) docker compose ps ;;
  validate)
    docker compose run --rm wapphub-core-api sh -c 'npm run lint && npm run typecheck && npm test && npm run build'
    ;;
  *) printf 'Usage: %s {up|deploy|stop|logs|status|validate}\n' "$0"; exit 2 ;;
esac
