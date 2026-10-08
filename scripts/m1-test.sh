#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "init" ]]; then
  python3 - <<'PY'
from pathlib import Path
import os, secrets
p=Path('.env.m1-test')
if p.exists():
    print('Test configuration already exists; preserved')
else:
    password, root, key=secrets.token_hex(24), secrets.token_hex(24), secrets.token_hex(32)
    with p.open('x') as f:
        os.chmod(p,0o600)
        f.write(f'NODE_ENV=test\nPORT=3000\nWEB_ORIGINS=https://web-client.example.test\nDATABASE_URL=mysql://wapphub_test:{password}@wapphub-db:3306/wapphub_m1_test\nDB_PASSWORD={password}\nDB_ROOT_PASSWORD={root}\nREDIS_URL=redis://wapphub-redis:6379\nENCRYPTION_KEY={key}\nENCRYPTION_KEY_VERSION=1\n')
    print('Isolated test configuration created with new credentials')
PY
  exit 0
fi
# Explicit file/project/env prevent accidental fallback to production Compose.
exec env -u DB_PASSWORD -u DB_ROOT_PASSWORD docker compose --env-file .env.m1-test -p wapphub-m1-test -f compose.test.yml "$@"
