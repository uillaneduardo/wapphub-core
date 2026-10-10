#!/bin/sh
set -eu
# Isolated CI/test project. Reuses the real Compose definition and hardening.
fixture=$(mktemp -d)
trap 'docker compose --env-file "$fixture/env" -f compose.yml -f "$fixture/override.yml" -p provider-web-compose-test stop provider-web >/dev/null 2>&1 || true; rm -f "$fixture/session-key" "$fixture/internal-key" "$fixture/env" "$fixture/override.yml"; rmdir "$fixture"' EXIT
node --input-type=module -e 'import{randomBytes}from"node:crypto";import{writeFileSync}from"node:fs";for(const name of["session-key","internal-key"])writeFileSync(process.argv[1]+"/"+name,randomBytes(32).toString("hex")+"\n",{mode:0o600});' "$fixture"
# Match the production non-root image user even when the CI runner UID differs.
docker run --rm --network none --user 0 --mount "type=bind,src=$fixture,dst=/fixture" --entrypoint node "${PROVIDER_WEB_TEST_IMAGE:?Set test image}" -e 'const fs=require("node:fs");for(const file of["session-key","internal-key"])fs.chownSync("/fixture/"+file,1000,1000);'
cat > "$fixture/env" <<EOF
PROVIDER_WEB_IMAGE=${PROVIDER_WEB_TEST_IMAGE:?Set test image}
PROVIDER_SESSION_KEY_FILE=$fixture/session-key
PROVIDER_INTERNAL_KEY_FILE=$fixture/internal-key
EOF
cat > "$fixture/override.yml" <<EOF
networks:
  core-backend:
    name: provider-web-compose-test-control
EOF
docker network inspect provider-web-compose-test-control >/dev/null 2>&1 || docker network create --internal provider-web-compose-test-control >/dev/null
docker compose --env-file "$fixture/env" -f compose.yml -f "$fixture/override.yml" -p provider-web-compose-test up -d --no-deps --no-build --pull never --wait --wait-timeout 60 provider-web
docker compose --env-file "$fixture/env" -f compose.yml -f "$fixture/override.yml" -p provider-web-compose-test exec -T provider-web node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r=>{const b=await r.json();if(!r.ok||b.connectionsEnabled!==false)process.exit(1);})"
